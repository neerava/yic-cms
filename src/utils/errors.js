/**
 * Domain errors for YIC CMS.
 * All errors carry an HTTP status code for easy translation at the API layer.
 */

class YICError extends Error {
  constructor(message, status = 500, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code ?? this.name.replace(/Error$/, '').toUpperCase().replace(/([A-Z])/g, '_$1').slice(1);
  }
}

class NotFoundError extends YICError {
  constructor(message = 'Resource not found') { super(message, 404); }
}

class ConflictError extends YICError {
  constructor(message = 'Resource conflict') { super(message, 409); }
}

class ForbiddenError extends YICError {
  constructor(message = 'Access denied') { super(message, 403); }
}

class UnauthorizedError extends YICError {
  constructor(message = 'Authentication required') { super(message, 401); }
}

class ValidationError extends YICError {
  constructor(message = 'Validation failed', errors = []) {
    super(message, 422);
    this.errors = errors;
  }
}

class WorkflowError extends YICError {
  constructor(message, stepId = null) {
    super(message, 400);
    this.stepId = stepId;
  }
}

class PublishError extends YICError {
  constructor(message, contentRef = null) {
    super(message, 400);
    this.contentRef = contentRef;
  }
}

class StorageError extends YICError {
  constructor(message, cause = null) {
    super(message, 503);
    this.cause = cause;
  }
}

module.exports = {
  YICError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  WorkflowError,
  PublishError,
  StorageError,
};
