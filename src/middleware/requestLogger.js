import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      userAgent: req.headers['user-agent'] || '',
    });
  });

  next();
}

export default requestLogger;
