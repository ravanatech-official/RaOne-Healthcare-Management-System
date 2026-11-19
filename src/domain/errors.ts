import type { ApiErrorEnvelope } from '../contracts/api.ts';

export class DomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly messageKey: string;
  public readonly retryable: boolean;
  public readonly nextStep?: string;

  constructor(opts: {
    statusCode: number;
    code: string;
    messageKey: string;
    message: string;
    retryable?: boolean;
    nextStep?: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.messageKey = opts.messageKey;
    this.retryable = opts.retryable ?? false;
    this.nextStep = opts.nextStep;
  }

  toEnvelope(correlationId: string): ApiErrorEnvelope {
    return {
      code: this.code,
      messageKey: this.messageKey,
      message: this.message,
      retryable: this.retryable,
      correlationId,
      ...(this.nextStep ? { nextStep: this.nextStep } : {}),
    };
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication required') {
    super({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      messageKey: 'errors.unauthenticated',
      message,
      retryable: false,
      nextStep: 'sign_in',
    });
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Access denied for this action', code = 'PERMISSION_DENIED', messageKey = 'errors.permission_denied') {
    super({
      statusCode: 403,
      code,
      messageKey,
      message,
      retryable: false,
    });
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Requested record not found') {
    super({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
      messageKey: 'errors.not_found',
      message,
      retryable: false,
    });
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Invalid input provided', messageKey = 'errors.validation_failed') {
    super({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      messageKey,
      message,
      retryable: false,
    });
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Record conflict occurred', code = 'CONFLICT', messageKey = 'errors.conflict') {
    super({
      statusCode: 409,
      code,
      messageKey,
      message,
      retryable: false,
    });
  }
}

export class CapabilityUnavailableError extends DomainError {
  constructor(message = 'Feature is not enabled for this clinic plan') {
    super({
      statusCode: 403,
      code: 'FEATURE_UNAVAILABLE',
      messageKey: 'errors.feature_unavailable',
      message,
      retryable: false,
    });
  }
}
