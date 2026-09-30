import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { isApiError } from '../errors';
import { log } from '../logging/index.js';
import { AuthRequest } from './auth';

function userMeta(req: Request): Record<string, unknown> {
  const authReq = req as AuthRequest;
  if (!authReq.userId) return {};
  return { userId: authReq.userId, username: authReq.username };
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestId = randomUUID();
  const meta = { requestId, ...userMeta(req) };

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err && (err as SyntaxError & { type?: string }).type === 'entity.parse.failed') {
    log('warn', `Client Error: 400 - Invalid JSON`, meta, 'http');
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // PostgreSQL unique violation -> conflict
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505') {
    log('warn', `Client Error: 409 - Unique violation`, meta, 'http');
    return res.status(409).json({ error: 'Conflict' });
  }

  // Check if it's an ApiError
  if (isApiError(err)) {
    // ApiError - respond with status and formatted error
    const response: { error: string; code?: string } = {
      error: err.message
    };
    
    // Include code if present
    if (err.code) {
      response.code = err.code;
    }
    
    // Log API errors at appropriate level (warn for client errors, error for server errors)
    if (err.status >= 500) {
      log('error', `API Error: ${err.status} - ${err.message}`, {
        ...meta,
        status: err.status,
        code: err.code,
        stack: err.stack
      }, 'http');
    } else {
      // Client errors (4xx) - log as warning
      log('warn', `Client Error: ${err.status} - ${err.message}`, {
        ...meta,
        status: err.status,
        code: err.code
      }, 'http');
    }
    
    return res.status(err.status).json(response);
  }
  
  // Unknown error - Internal Server Error
  // Log full stack trace for debugging
  log('error', 'Internal Server Error', {
    ...meta,
    message: err.message,
    stack: err.stack,
    name: err.name
  }, 'http');
  
  res.status(500).json({ 
    error: 'Internal server error'
  });
}
