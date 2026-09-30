import {
  createConversation,
  findConversationsByUserId,
  findConversationById,
  updateConversationTitle,
  deleteConversationById,
} from '../repositories/conversation.js';
import { findMessagesWithTotal, findLatestMessagesWithTotal } from '../repositories/message.js';
import { findChunksByConversationId } from '../repositories/chunk.js';
import { Conversation, Message, HistoryScope } from '../types/index.js';
import { ApiError } from '../errors.js';
import { log } from '../logging/index.js';

export async function create(userId: string, title?: string) {
  const conversation = await createConversation(userId, title ?? 'New conversation');
  log('info', 'Conversation created', { userId, conversationId: conversation.id, title: conversation.title }, 'conversations');
  return { conversation };
}

export async function list(userId: string, options?: { limit?: number; offset?: number }) {
  const { conversations, total } = await findConversationsByUserId(userId, options);
  return { conversations, total };
}

export async function get(userId: string, id: string, scope?: HistoryScope) {
  const conversation = await findConversationById(id, userId);
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const { from, to } = scope ?? {};
  const { rows: messages, total } =
    from !== undefined && to !== undefined
      ? await findMessagesWithTotal(id, { limit: to - from + 1, offset: from - 1 })
      : await findLatestMessagesWithTotal(id, 100);

  return { conversation, messages, total };
}

export async function updateTitle(userId: string, id: string, title: string) {
  const conversation = await updateConversationTitle(id, userId, title);
  if (!conversation) throw ApiError.notFound('Conversation not found');
  return { conversation };
}

export async function getChunks(userId: string, id: string, options?: { limit?: number; offset?: number }) {
  const conversation = await findConversationById(id, userId);
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const { rows: chunks, total } = await findChunksByConversationId(id, {
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  });

  return { conversation, chunks, total };
}

export async function remove(userId: string, id: string) {
  const conversation = await findConversationById(id, userId);
  if (!conversation) throw ApiError.notFound('Conversation not found');
  await deleteConversationById(id, userId);
  log('info', 'Conversation deleted', { userId, conversationId: id }, 'conversations');
}