import { config } from './config.js';

function parseLoadOptions(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('Invalid JSON in model load options, ignoring');
    return undefined;
  }
}

export async function waitForLMStudio(): Promise<void> {
  for (let i = 0; i < config.LMSTUDIO_MAX_RETRIES; i++) {
    try {
      const res = await fetch(`${config.LMSTUDIO_CONFIG_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${config.LMSTUDIO_API_KEY}` },
      });
      if (res.ok) {
        console.log('LM Studio API is ready');
        return;
      }
    } catch {
      // not ready yet
    }
    console.log(`Waiting for LM Studio API... (${i + 1}/${config.LMSTUDIO_MAX_RETRIES})`);
    await new Promise(r => setTimeout(r, config.LMSTUDIO_RETRY_INTERVAL));
  }
  throw new Error('LM Studio API did not become ready');
}

interface ModelInstance {
  loaded_instances?: {id: string}[]
}

export async function unloadAllModels(): Promise<void> {
  const listRes = await fetch(`${config.LMSTUDIO_CONFIG_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${config.LMSTUDIO_API_KEY}` },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Failed to list models (${listRes.status}): ${text}`);
  }
  const listData: { models: ModelInstance[] } = await listRes.json();

  const instanceIDs: string[] = [];
  listData.models.forEach(model => {
    if(model.loaded_instances && Array.isArray(model.loaded_instances)){
      model.loaded_instances.forEach((instance)=>{
        instanceIDs.push(instance.id);
      })
    }
  });
  
  if (instanceIDs.length === 0) {
    console.log('No models currently loaded');
    return;
  }
  for (const instanceId of instanceIDs) {
    const res = await fetch(`${config.LMSTUDIO_CONFIG_BASE_URL}/models/unload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.LMSTUDIO_API_KEY}`,
      },
      body: JSON.stringify({ instance_id: instanceId }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`Failed to unload model instance "${instanceId}": (${res.status}) ${text}`);
    } else {
      console.log(`Unloaded model instance "${instanceId}"`);
    }
  }
}

export async function loadModel(
  modelName: string,
  rawOptions: string,
): Promise<void> {
  const body: Record<string, unknown> = { model: modelName };
  const options = parseLoadOptions(rawOptions);
  if (options) Object.assign(body, options);

  const res = await fetch(`${config.LMSTUDIO_CONFIG_BASE_URL}/models/load`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LMSTUDIO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to load model "${modelName}" (${res.status}): ${text}`);
  }
  console.log(`Model "${modelName}" loaded`);
}

export async function initLMStudio(): Promise<void> {
  await waitForLMStudio();
  await unloadAllModels();

  console.log(`Loading embedding model: ${config.EMBEDDING_MODEL}`);
  await loadModel(config.EMBEDDING_MODEL, config.LMSTUDIO_EMBEDDING_LOAD_OPTIONS);

  console.log(`Loading LLM model: ${config.LLM_MODEL}`);
  await loadModel(config.LLM_MODEL, config.LMSTUDIO_LLM_LOAD_OPTIONS);

  console.log('LM Studio initialization complete');
}

/**
 * Embedding request (non‑streaming)
 */
export async function getEmbedding(input: string | string[]): Promise<number[][]> {
  const response = await fetch(`${config.LMSTUDIO_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LMSTUDIO_API_KEY}`,
    },
    body: JSON.stringify({
      input,
      model: config.EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/**
 * Chat completion (non‑streaming)
 */
export async function getChatCompletion(messages: any[]): Promise<string> {
  const response = await fetch(`${config.LMSTUDIO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LMSTUDIO_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Chat completion with streaming.
 * Calls onToken for each content token, supports abort via AbortSignal.
 */
export async function getChatCompletionStream(
  messages: any[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const body = JSON.stringify({
    model: config.LLM_MODEL,
    messages,
    stream: true,
  })
  const response = await fetch(`${config.LMSTUDIO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LMSTUDIO_API_KEY}`,
    },
    body,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat API stream error (${response.status}): ${errorText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return fullContent;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onToken(content);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  return fullContent;
}