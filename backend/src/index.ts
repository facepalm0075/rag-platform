import http from 'http';
import app from './app.js';
import { config } from './config/index.js';
import { workerPool } from './services/workerPool.js';
import { ensureExampleEmbeddings } from './services/exampleEmbeddings.js';
import { deleteExpiredSessions } from './repositories/session.js';
import { log } from './logging/index.js';

const server = http.createServer(app);

workerPool.initialize(server);

workerPool.onWorkerConnected = () => {
  void ensureExampleEmbeddings();
};

server.listen(config.PORT, () => {
  log('info', `RAG Backend running on port ${config.PORT}`, {}, 'system');
  void ensureExampleEmbeddings();
});

const SESSION_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function purgeExpiredSessions() {
  try {
    const count = await deleteExpiredSessions(7);
    if (count > 0) log('info', `Purged ${count} expired sessions`, {}, 'system');
  } catch (err) {
    log('error', 'Session purge failed', { message: err instanceof Error ? err.message : String(err) }, 'system');
  }
}

const sessionPurgeTimer = setInterval(() => {
  void purgeExpiredSessions();
}, SESSION_PURGE_INTERVAL_MS);
sessionPurgeTimer.unref();
void purgeExpiredSessions();

function shutdown() {
  log('info', 'Shutting down...', {}, 'system');
  workerPool.shutdown();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
