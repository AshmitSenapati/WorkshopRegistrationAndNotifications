import config from '../config/index.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  let error = err;

  // Handle Mongoose / MongoDB duplicate key error (code 11000)
  if (err.code === 11000) {
    const keys = Object.keys(err.keyPattern || {});
    const message = `Duplicate value for field(s): ${keys.join(', ')}`;
    error = new AppError(message, 409, { duplicateFields: keys });
  }

  // Handle direct ZodError
  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || [];
    const details = issues.map((e) => ({
      path: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
      message: e.message,
    }));
    error = new AppError('Validation failed', 400, details);
  }

  // Handle JSON parsing syntax error
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    error = new AppError('Malformed JSON body', 400);
  }

  const statusCode = error.statusCode || 500;
  const isOperational = error.isOperational || false;

  logger.error('Error encountered', {
    requestId: req.id,
    statusCode,
    message: error.message,
    stack: error.stack,
    details: error.details,
    isOperational,
  });

  const response = {
    success: false,
    error: {
      message: error.message || 'Internal server error',
      code: error.name || 'INTERNAL_ERROR',
      ...(error.details ? { details: error.details } : {}),
      ...(config.NODE_ENV !== 'production' && !isOperational ? { stack: error.stack } : {}),
    },
  };

  res.status(statusCode).json(response);
}

export default errorHandler;
