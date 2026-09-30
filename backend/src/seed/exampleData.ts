import { ChunkInput } from '../types/index.js';

export const EXAMPLE_CONVERSATION_TITLE = 'Example conversation';
export const EXAMPLE_DOCUMENT_TITLE = 'Getting started guide';

export const EXAMPLE_CHUNKS: ChunkInput[] = [
  {
    content:
      'Welcome to the RAG Assistant, a retrieval-augmented generation chat application. ' +
      'You can ask questions in this conversation, and the assistant will answer using the knowledge ' +
      'stored in your uploaded documents, combined with its general capabilities. ' +
      'This conversation comes pre-loaded with a sample document so you can try it out right away.',
    chunk_index: 0,
  },
  {
    content:
      'To add your own knowledge, use the documents feature: create a document with a title and a list ' +
      'of content chunks. The backend embeds every chunk and stores it in a vector database. ' +
      'You can list, view, and delete your documents at any time.',
    chunk_index: 1,
  },
  {
    content:
      'When you send a question, the backend converts it into an embedding and searches for the most ' +
      'similar stored chunks (the top 5 by default). Those chunks are injected into the prompt as context, ' +
      'and the language model generates an answer grounded in that context.',
    chunk_index: 2,
  },
  {
    content:
      'Each conversation keeps its own history, and the assistant sees your recent messages to provide ' +
      'context-aware answers. You can create multiple conversations and rename them whenever you want.',
    chunk_index: 3,
  },
  {
    content:
      'Your documents and conversations are private to your account. Every user can only access their own ' +
      'data, and vector searches are scoped to the currently authenticated user\'s documents.',
    chunk_index: 4,
  },
];
