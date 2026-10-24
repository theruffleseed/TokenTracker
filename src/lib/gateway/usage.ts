import type { GatewayEndpoint } from "./config";

export interface CapturedUsage {
  modelId: string | null;
  /** Regular (non-cached) input tokens. */
  inputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}

const EMPTY: CapturedUsage = {
  modelId: null,
  inputTokens: null,
  cachedTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
};

function count(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function hasUsage(usage: CapturedUsage): boolean {
  return (
    usage.inputTokens !== null ||
    usage.cachedTokens !== null ||
    usage.cacheWriteTokens !== null ||
    usage.outputTokens !== null
  );
}

/**
 * OpenAI chat, Responses and most compatible servers report `prompt_tokens`
 * inclusive of cached input. Split it so cached tokens are priced correctly.
 */
export function usageFromOpenAI(payload: unknown, fallbackModel?: string | null): CapturedUsage | null {
  const body = record(payload);
  if (!body) return null;
  const usage = record(body.usage);
  if (!usage) return null;

  const prompt = count(usage.prompt_tokens ?? usage.input_tokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens);
  const promptDetails = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const outputDetails = record(usage.completion_tokens_details ?? usage.output_tokens_details);
  const cached = count(promptDetails?.cached_tokens);
  const reasoning = count(outputDetails?.reasoning_tokens);

  if (prompt === null && output === null) return null;

  return {
    modelId: text(body.model) ?? text(fallbackModel) ?? null,
    inputTokens: prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
    cachedTokens: cached,
    cacheWriteTokens: null,
    outputTokens: output,
    reasoningTokens: reasoning,
  };
}

/**
 * Anthropic reports regular input, cache reads and cache writes separately;
 * `input_tokens` is not inclusive of either cache field.
 */
export function usageFromAnthropic(payload: unknown, fallbackModel?: string | null): CapturedUsage | null {
  const body = record(payload);
  if (!body) return null;
  const usage = record(body.usage);
  if (!usage) return null;

  const input = count(usage.input_tokens);
  const cached = count(usage.cache_read_input_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const output = count(usage.output_tokens);
  if (input === null && cached === null && cacheWrite === null && output === null) return null;

  return {
    modelId: text(body.model) ?? text(fallbackModel) ?? null,
    inputTokens: input,
    cachedTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: null,
  };
}

export function usageFromJson(
  payload: unknown,
  endpoint: GatewayEndpoint,
  fallbackModel?: string | null,
): CapturedUsage | null {
  if (endpoint === "anthropic_messages") {
    return usageFromAnthropic(payload, fallbackModel);
  }
  if (endpoint === "openai_chat" || endpoint === "openai_responses") {
    return usageFromOpenAI(payload, fallbackModel);
  }
  return null;
}

function merge(base: CapturedUsage, next: CapturedUsage): CapturedUsage {
  return {
    modelId: next.modelId ?? base.modelId,
    inputTokens: next.inputTokens ?? base.inputTokens,
    cachedTokens: next.cachedTokens ?? base.cachedTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? base.cacheWriteTokens,
    outputTokens: next.outputTokens ?? base.outputTokens,
    reasoningTokens: next.reasoningTokens ?? base.reasoningTokens,
  };
}

/**
 * Incrementally reads server-sent events while the response is streamed to the
 * client. Only complete `data:` JSON events are parsed; usage is merged because
 * Anthropic splits input and output across message_start/message_delta.
 */
export class SseUsageCollector {
  private buffer = "";
  private usage: CapturedUsage = { ...EMPTY };

  constructor(
    private readonly endpoint: GatewayEndpoint,
    private readonly fallbackModel: string | null = null,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.handleBlock(block);
      boundary = this.buffer.indexOf("\n\n");
    }
  }

  finish(): CapturedUsage | null {
    if (this.buffer.trim()) {
      this.handleBlock(this.buffer);
      this.buffer = "";
    }
    return hasUsage(this.usage) ? this.usage : null;
  }

  private handleBlock(block: string): void {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        this.handleEvent(JSON.parse(data));
      } catch {
        // Comment/keepalive events and partial vendor extensions are ignored.
      }
    }
  }

  private handleEvent(event: unknown): void {
    const body = record(event);
    if (!body) return;

    if (this.endpoint === "anthropic_messages") {
      if (body.type === "message_start") {
        const message = record(body.message);
        if (!message) return;
        const usage = usageFromAnthropic(message, this.fallbackModel);
        if (usage) this.usage = merge(this.usage, usage);
        return;
      }
      if (body.type === "message_delta") {
        // Output-only deltas do not repeat the model; keep the one from start.
        const usage = usageFromAnthropic(body, null);
        if (usage) this.usage = merge(this.usage, usage);
        return;
      }
      return;
    }

    if (this.endpoint === "openai_responses") {
      if (body.type === "response.completed") {
        const usage = usageFromOpenAI(body.response, this.fallbackModel);
        if (usage) this.usage = merge(this.usage, usage);
        return;
      }
      if (body.usage) {
        const usage = usageFromOpenAI(body, this.fallbackModel);
        if (usage) this.usage = merge(this.usage, usage);
      }
      return;
    }

    if (body.usage) {
      const usage = usageFromOpenAI(body, this.fallbackModel);
      if (usage) this.usage = merge(this.usage, usage);
    }
  }
}
