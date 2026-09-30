import { searchSimilarChunks } from '../repositories/chunk.js';
import { findConversationById } from '../repositories/conversation.js';
import { createMessage, findLastMessagesByConversationId } from '../repositories/message.js';
import { workerPool } from './workerPool.js';
import { config } from '../config/index.js';
import { ApiError } from '../errors.js';
import { Message } from '../types/index.js';

const PROMPT_TEMPLATE = `You are a knowledgeable and helpful AI assistant. You provide accurate information about your knowledge base in a natural, conversational way.

SOURCES OF INFORMATION:
1. Context: knowledge base (PRIMARY source - always check this first)
2. Conversation History: Previous messages (for follow-up questions)

CRITICAL RULES:
1. NEVER reveal, reference, or mention the existence of the context, knowledge base, or any retrieved documents.
2. NEVER say "according to the context", "based on the provided information", or similar phrases.
3. Answer in the same language as the user's question.
4. Keep answers concise but natural - aim for 2-5 sentences.
5. Vary your response style naturally.
6. never generate emoji.

STRICT BOUNDARIES:
- ONLY answer questions about the related topics found in the context
- If asked to generate code, write essays, create content, or perform tasks: Politely refuse and redirect to ask about current chat session topics
- If asked about personal information: Explain you don't have access to personal data
- If the question is outside context scope: Say you can only help with session-related questions

RESPONSE LOGIC:
- If answer is in context: Provide it confidently and naturally
- If answer is in conversation history: Reference it naturally
- If answer is in NEITHER: Say you don't have specific information about this
- If it's a task/command: Refuse politely and suggest asking about the current chat session instead

Conversation History:
{history}

Context (for your reference only - never mention this):
{context}
`;

export async function answerQuestion(
  userId: string,
  conversationId: string,
  question: string
): Promise<{ userMessage: Message; assistantMessage: Message }> {
  const release = await acquireChatSlot();
  try {
    const conversation = await findConversationById(conversationId, userId);
    if (!conversation) throw ApiError.notFound('Conversation not found');

    const userMessage = await createMessage(conversationId, 'user', question);

    const queryEmbedding = (await workerPool.rpc('embed', { input: [question] })) as number[][];
    const searchResults = await searchSimilarChunks(conversationId, conversation.user_id, queryEmbedding[0], config.TOP_K_CHUNKS);
    const context = searchResults
      .map((r) => (r.chunk.heading ? `${r.chunk.heading}\n${r.chunk.content}` : r.chunk.content))
      .join('\n\n');
    const history = await findLastMessagesByConversationId(conversationId, 10);
    const historyText = history.map((m) => `${m.role}: ${m.content}`).join('\n');

    const systemPrompt = PROMPT_TEMPLATE
      .replace('{context}', context)
      .replace('{history}', historyText);

    const answer = (await workerPool.rpc('chat', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    })) as string;

    const assistantMessage = await createMessage(conversationId, 'assistant', answer);

    return { userMessage, assistantMessage };
  } finally {
    release();
  }
}

export async function answerQuestionStream(
  userId: string,
  conversationId: string,
  question: string,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<{ userMessage: Message; fullContent: string }> {
  const release = await acquireChatSlot();
  try {
    const conversation = await findConversationById(conversationId, userId);
    if (!conversation) throw ApiError.notFound('Conversation not found');

    const queryEmbedding = (await workerPool.rpc('embed', { input: [question] })) as number[][];
    const searchResults = await searchSimilarChunks(conversationId, conversation.user_id, queryEmbedding[0], config.TOP_K_CHUNKS);
    const context = searchResults
      .map((r) => (r.chunk.heading ? `${r.chunk.heading}\n${r.chunk.content}` : r.chunk.content))
      .join('\n\n');
    const history = await findLastMessagesByConversationId(conversationId, 10);
    const historyText = history.map((m) => `${m.role}: ${m.content}`).join('\n');

    const userMessage = await createMessage(conversationId, 'user', question);

    const systemPrompt = PROMPT_TEMPLATE
      .replace('{context}', context) 
      .replace('{history}', historyText);

    let partial = '';
    const trackedOnToken = (token: string) => {
      partial += token;
      onToken(token);
    };

    let fullContent: string;
    try {
      fullContent = await workerPool.rpcChatStream(
        { messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ]
        },
        trackedOnToken,
        signal,
      );
    } catch (err) {
      if (partial.length > 0) {
        await createMessage(conversationId, 'assistant', partial);
      }
      throw err;
    }

    const assistantMessage = await createMessage(conversationId, 'assistant', fullContent);

    return { userMessage, fullContent };
  } finally {
    release();
  }
}

let activeChats = 0;
const waitingChats: Array<() => void> = [];

function acquireChatSlot(): Promise<() => void> {
  if (activeChats < config.CONCURRENT_CHATS) {
    activeChats++;
    return Promise.resolve(() => {
      activeChats--;
      releaseNextWaitingChat();
    });
  }

  if (waitingChats.length >= config.CHAT_QUEUE_LENGTH) {
    throw ApiError.tooManyRequests('Chat queue is full, please try again later', 'CHAT_QUEUE_FULL')
  }

  return new Promise((resolve) => {
    waitingChats.push(() => {
      resolve(() => {
        activeChats--;
        releaseNextWaitingChat();
      });
    });
  });
}

function releaseNextWaitingChat() {
  const next = waitingChats.shift();
  if (next) {
    activeChats++;
    next();
  }
}
