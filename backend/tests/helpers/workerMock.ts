import { vi, Mock } from 'vitest';

export interface WorkerMock {
  rpc: Mock;
  rpcChatStream: Mock;
}

export const EMBED_VECTOR = Array.from({ length: 768 }, () => 0.01);

export function mockDefaultWorkerBehavior(wm: WorkerMock) {
  wm.rpc.mockReset();
  wm.rpcChatStream.mockReset();

  wm.rpc.mockImplementation(async (type: string, payload: { input?: string[] }) => {
    if (type === 'embed') {
      const count = payload.input?.length ?? 1;
      return Array.from({ length: count }, () => EMBED_VECTOR);
    }
    return 'mock chat answer';
  });

  wm.rpcChatStream.mockImplementation(
    async (
      _payload: unknown,
      onToken: (token: string) => void,
    ): Promise<string> => {
      const parts = ['Mock ', 'stream ', 'answer'];
      for (const part of parts) onToken(part);
      return 'Mock stream answer';
    }
  );
}