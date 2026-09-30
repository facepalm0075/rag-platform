// ============================================================================
// CLIENT-SIDE CHUNKER
// Splits raw document text into ordered chunks of ~800–1500 chars, detecting a
// header for each chunk when one is present. Output order is meaningful and is
// preserved when sent to the backend.
// ============================================================================

import { chunking } from "@/config";

export type Chunk = { header: string; content: string };

export const MIN_CHARS = chunking.minChars;
export const MAX_CHARS = chunking.maxChars;

/** Separator ladder, tried in order from coarsest to finest. */
const SEPARATORS = ["\n\n\n", "\n\n", "\n", ". "] as const;

function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

/** Recursively split `text` so that no piece exceeds `max` characters. */
function splitRecursive(text: string, max: number, depth = 0): string[] {
  if (text.length <= max) return [text];
  if (depth >= SEPARATORS.length) return hardSplit(text, max);

  const sep = SEPARATORS[depth];
  const parts = text.split(sep);
  if (parts.length === 1) return splitRecursive(text, max, depth + 1);

  // Greedily re-join parts into pieces as large as possible without exceeding max.
  const pieces: string[] = [];
  let buf = "";
  for (const part of parts) {
    const candidate = buf ? buf + sep + part : part;
    if (candidate.length <= max) {
      buf = candidate;
    } else {
      if (buf) pieces.push(buf);
      buf = part;
    }
  }
  if (buf) pieces.push(buf);

  // Anything still too big goes one level finer.
  return pieces.flatMap((p) =>
    p.length > max ? splitRecursive(p, max, depth + 1) : [p],
  );
}

/** Merge adjacent small pieces so chunks land in the 800–1500 range. */
function mergeSmall(pieces: string[], min: number, max: number): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length < min && last.length + p.length + 2 <= max) {
      out[out.length - 1] = `${last}\n\n${p}`;
    } else {
      out.push(p);
    }
  }
  return out;
}

const HEADER_MAX_LEN = 120;

/** Heuristics: does this single line read like a section header? */
function isHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > HEADER_MAX_LEN) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true; // markdown heading
  if (/^(chapter|section|part|appendix)\b/i.test(t)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(t) && t.length <= 90) return true; // "2.1 Scope"
  if (/[.!?,;:]$/.test(t)) return false; // sentence-like
  const words = t.split(/\s+/);
  if (words.length > 14) return false;
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) return true; // ALL CAPS
  if (t.endsWith(":")) return true;
  // Title Case-ish short line
  const capitalised = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return words.length <= 10 && capitalised / words.length >= 0.6;
}

function cleanHeader(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[:\s]+$/, "");
}

/** Pull a header off the top of a chunk if the first line looks like one. */
function extractHeader(text: string, fallback: string): Chunk {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const first = lines[i];
  if (first !== undefined && isHeaderLine(first)) {
    const content = lines
      .slice(i + 1)
      .join("\n")
      .trim();
    if (content) return { header: cleanHeader(first), content };
  }
  return { header: fallback, content: text.trim() };
}

export type ChunkOptions = {
  min?: number;
  max?: number;
  /** Used when no header can be detected, e.g. the file name. */
  fallbackHeader?: string;
};

export function chunkText(raw: string, options: ChunkOptions = {}): Chunk[] {
  const min = options.min ?? MIN_CHARS;
  const max = options.max ?? MAX_CHARS;
  const fallback = options.fallbackHeader ?? "Untitled section";

  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!text) return [];

  const pieces = mergeSmall(
    splitRecursive(text, max).map((p) => p.trim()).filter(Boolean),
    min,
    max,
  );

  let lastHeader = fallback;
  return pieces.map((p, idx) => {
    const chunk = extractHeader(p, `${lastHeader} (cont. ${idx + 1})`);
    if (chunk.header && !chunk.header.startsWith(lastHeader)) lastHeader = chunk.header;
    return chunk;
  });
}
