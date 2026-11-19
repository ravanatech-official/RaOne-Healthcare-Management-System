import type { Response } from 'express';
import { DomainError } from '../domain/errors.ts';

export function sendApiError(res: Response, error: unknown, correlationId: string) {
  if (error instanceof DomainError) {
    return res.status(error.statusCode).json(error.toEnvelope(correlationId));
  }
  console.error('Unhandled API error:', { correlationId, error });
  return res.status(500).json({
    code: 'INTERNAL_ERROR',
    messageKey: 'errors.internal',
    message: 'An unexpected error occurred. Please try again.',
    retryable: true,
    correlationId,
  });
}
