import { createLogger } from '../../src/logger.js';

export function captureLogger(config) {
  const chunks = [];
  const destination = { write: (s) => { chunks.push(s); } };
  const logger = createLogger({ ...config, logLevel: 'debug', nodeEnv: 'test' }, destination);
  return {
    logger,
    raw: () => chunks.join(''),
    lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}
