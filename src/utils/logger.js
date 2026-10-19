import config from '../config/index.js';

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevelPriority = LOG_LEVELS[config?.LOG_LEVEL || 'info'] || 20;

function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...meta,
  };

  if (meta instanceof Error) {
    entry.error = {
      message: meta.message,
      stack: meta.stack,
      name: meta.name,
    };
  }

  return JSON.stringify(entry);
}

export const logger = {
  debug(message, meta) {
    if (currentLevelPriority <= LOG_LEVELS.debug) {
      console.debug(formatLog('debug', message, meta));
    }
  },
  info(message, meta) {
    if (currentLevelPriority <= LOG_LEVELS.info) {
      console.log(formatLog('info', message, meta));
    }
  },
  warn(message, meta) {
    if (currentLevelPriority <= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', message, meta));
    }
  },
  error(message, meta) {
    if (currentLevelPriority <= LOG_LEVELS.error) {
      console.error(formatLog('error', message, meta));
    }
  },
};

export default logger;
