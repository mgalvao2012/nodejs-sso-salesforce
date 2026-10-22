import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config.databaseUrl, logger);
const app = createApp({ pool, config, logger });

const server =
  config.tlsCertFile && config.tlsKeyFile
    ? https.createServer(
        { cert: fs.readFileSync(config.tlsCertFile), key: fs.readFileSync(config.tlsKeyFile) },
        app,
      )
    : http.createServer(app);

server.listen(config.port, () => {
  logger.info({ port: config.port, tls: server instanceof https.Server }, 'server.started');
});

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'process.unhandled_rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'process.uncaught_exception');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('server.shutting_down');
  server.close(async () => {
    await pool.end();
    logger.info('server.stopped');
    process.exit(0);
  });
});
