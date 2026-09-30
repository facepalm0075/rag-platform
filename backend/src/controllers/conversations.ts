import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import * as conversationService from '../services/conversations.js';
import { findConversationById } from '../repositories/conversation.js';
import { answerQuestionStream } from '../services/rag.js';
import { ApiError, isApiError } from '../errors.js';
import { log } from '../logging/index.js';
import { createMessage } from '../repositories/message.js';

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await conversationService.create(req.userId!, req.body.title);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { limit, offset } = req.query as { limit?: number; offset?: number };
    const result = await conversationService.list(req.userId!, { limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as { from?: number; to?: number };
    const result = await conversationService.get(
      req.userId!,
      req.params.id,
      from !== undefined && to !== undefined ? { from, to } : undefined
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateTitle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await conversationService.updateTitle(req.userId!, req.params.id, req.body.title);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getChunks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { limit, offset } = req.query as { limit?: number; offset?: number };
    const result = await conversationService.getChunks(req.userId!, req.params.id, { limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await conversationService.remove(req.userId!, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversation = await findConversationById(req.params.id, req.userId!);
    if (!conversation) throw ApiError.notFound('Conversation not found');
  } catch (err) {
    return next(err);
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const controller = new AbortController();
  let connected = true;

  const onDisconnect = () => {
    if (res.writableEnded) return;
    connected = false;
    controller.abort();
  };
  // Client disconnect / request aborted
  req.on("aborted", onDisconnect);
  req.on("close", onDisconnect);

  // IMPORTANT for SSE: response connection closed
  res.on("close", onDisconnect);

  res.on("error", (err) => {
    log(
      "error",
      "SSE response error",
      {
        message: err.message,
        conversationId: req.params.id,
      },
      "conversations",
    );

    onDisconnect();
  });

  const { content } = req.body;
  const conversationId = req.params.id;
  log('info', 'Chat stream started', {
    userId: req.userId,
    username: req.username,
    conversationId,
  }, 'conversations');
  try {  
    const { fullContent } = await answerQuestionStream(
      req.userId!,
      conversationId,
      content,
      (token) => {
        if (!controller.signal.aborted && connected) {
          res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
        }
      },
      controller.signal,
    );

    if (!controller.signal.aborted && connected) {
      res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
    }
  } catch (err) {
    log('error', 'SSE stream failed', {
      userId: req.userId,
      username: req.username,
      conversationId: req.params.id,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }, 'conversations');
    if (!controller.signal.aborted && connected) {
      const message = isApiError(err) ? err.message : 'Streaming failed: no AI-Worker available right now!\nPleas try again in maximum (2 hours)';
      createMessage(conversationId, 'system', message);
      res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
    }
  } finally {
    res.end();
  }
}
