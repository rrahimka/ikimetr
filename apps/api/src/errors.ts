export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'authentication required') {
    super(401, 'unauthenticated', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'operation not permitted') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'resource not found') {
    super(404, 'not_found', message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'validation error') {
    super(400, 'validation_error', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'resource conflict') {
    super(409, 'conflict', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'too many requests') {
    super(429, 'rate_limited', message);
  }
}
