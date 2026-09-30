export interface WorkerRequest {
  id: string;
  type: 'embed' | 'chat' | 'abort';
  payload: Record<string, any>;
}

export interface WorkerResponse {
  id: string;
  success?: boolean;
  data?: unknown;
  error?: string;
  content?: string;
  done?: boolean;
}