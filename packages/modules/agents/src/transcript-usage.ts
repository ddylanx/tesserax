import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Tokens in the context window at the last assistant turn. */
  contextTokens: number | null;
  model: string | null;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Sums token usage from a Claude Code transcript (JSONL). Hooks carry no token counts, but every
 * assistant line has message.usage; one message can span several lines with the same id, so the
 * last line per id wins. Only usage numbers and the model name are read.
 */
export async function readTranscriptUsage(path: string): Promise<TranscriptUsage | null> {
  if (!existsSync(path)) return null;
  const byId = new Map<string, Usage>();
  let last: Usage | null = null;
  let model: string | null = null;
  let anon = 0;
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = row?.message;
    if (row?.type !== 'assistant' || !msg?.usage) continue;
    byId.set(msg.id ?? `anon-${anon++}`, msg.usage);
    if (!row.isSidechain) {
      last = msg.usage;
      if (typeof msg.model === 'string' && msg.model !== '<synthetic>') model = msg.model;
    }
  }
  if (byId.size === 0) return null;
  const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const u of byId.values()) {
    sum.inputTokens += u.input_tokens ?? 0;
    sum.outputTokens += u.output_tokens ?? 0;
    sum.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    sum.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
  }
  const contextTokens = last ? (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) : null;
  return { ...sum, contextTokens, model };
}
