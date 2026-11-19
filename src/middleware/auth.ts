import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';
import { UnauthenticatedError } from '../domain/errors.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  preferredLocale: 'si-LK' | 'en-LK';
  authTime?: number;
}

export interface AuthRequest extends Request {
  correlationId?: string;
  authUser?: AuthenticatedUser;
}

export function attachCorrelationId(req: AuthRequest, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const correlationId =
    incoming && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming)
      ? incoming
      : `req_${crypto.randomUUID()}`;
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}

let revocationCheckUnavailable = false;

function isRevocationInfraError(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | undefined;
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  if (
    code === 'auth/id-token-revoked' ||
    code === 'auth/id-token-expired' ||
    code === 'auth/argument-error' ||
    code === 'auth/user-disabled' ||
    code === 'auth/user-not-found'
  ) {
    return false;
  }
  return (
    code === 'auth/internal-error' ||
    code === 'app/invalid-credential' ||
    msg.includes('identitytoolkit') ||
    msg.includes('credential') ||
    msg.includes('metadata') ||
    msg.includes('permission')
  );
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const correlationId = req.correlationId ?? `req_${crypto.randomUUID()}`;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new UnauthenticatedError('Missing Bearer authentication token');
    return res.status(err.statusCode).json(err.toEnvelope(correlationId));
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    const err = new UnauthenticatedError('Empty Bearer token');
    return res.status(err.statusCode).json(err.toEnvelope(correlationId));
  }

  try {
    // 1. Always verify cryptographic RS256 signature, issuer, audience, and expiry via Google public keys
    const decoded = await adminAuth.verifyIdToken(token, false);

    // 2. Check user revocation/disabled state when Identity Toolkit ADC is available
    if (!revocationCheckUnavailable) {
      try {
        const userRecord = await adminAuth.getUser(decoded.uid);
        if (userRecord.disabled) {
          throw Object.assign(new Error('Firebase user is disabled'), { code: 'auth/user-disabled' });
        }
        if (userRecord.tokensValidAfterTime) {
          const validAfterSec = Math.floor(new Date(userRecord.tokensValidAfterTime).getTime() / 1000);
          if (typeof decoded.auth_time === 'number' && decoded.auth_time < validAfterSec) {
            throw Object.assign(new Error('Firebase ID token has been revoked'), {
              code: 'auth/id-token-revoked',
            });
          }
        }
      } catch (revErr) {
        if (isRevocationInfraError(revErr)) {
          revocationCheckUnavailable = true;
          console.warn('Firebase revocation lookup unavailable in current ADC context; falling back to verified JWT claims.', {
            correlationId,
            code: (revErr as { code?: string })?.code,
          });
        } else {
          throw revErr;
        }
      }
    }

    const email = decoded.email ?? `${decoded.uid}@unknown.local`;
    const dbUser = await getOrCreateUser(decoded.uid, email, decoded.name);

    req.authUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      displayName: dbUser.displayName,
      preferredLocale: dbUser.preferredLocale === 'en-LK' ? 'en-LK' : 'si-LK',
      authTime: decoded.auth_time,
    };
    return next();
  } catch (error) {
    const errObj = error as { code?: string; message?: string } | undefined;
    console.error('Firebase token verification failed:', {
      correlationId,
      code: errObj?.code,
      message: errObj?.message,
    });
    const err = new UnauthenticatedError('Invalid or expired session token');
    return res.status(err.statusCode).json(err.toEnvelope(correlationId));
  }
};
