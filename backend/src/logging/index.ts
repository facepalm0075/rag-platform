import { insertSystemLog } from '../repositories/systemLog.js';
import { LogLevel } from '../types/index.js';

export { LogLevel } from '../types/index.js';

export type { LogLevel as LogLevelType } from '../types/index.js';

function consoleWrite(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (meta && Object.keys(meta).length > 0) payload.meta = meta;
  console.log(JSON.stringify(payload));
}

export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
  category = 'app'
): void {
  consoleWrite(level, message, meta);

  const { userId, username } = extractUser(meta);
  void insertSystemLog(level, category, message, meta ?? {}, { userId, username }).catch(
    (err: unknown) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Failed to persist system log entry',
          meta: { error: err instanceof Error ? err.message : String(err) },
        })
      );
    }
  );
}

function extractUser(meta?: Record<string, unknown>) {
  if (!meta || typeof meta !== 'object') return {};
  const userId = typeof meta.userId === 'string' ? meta.userId : undefined;
  const username = typeof meta.username === 'string' ? meta.username : undefined;
  return { userId, username };
}

export function logInfo(message: string, meta?: Record<string, unknown>, category?: string) {
  log('info', message, meta, category);
}

export function logWarn(message: string, meta?: Record<string, unknown>, category?: string) {
  log('warn', message, meta, category);
}

export function logError(message: string, meta?: Record<string, unknown>, category?: string) {
  log('error', message, meta, category);
}
