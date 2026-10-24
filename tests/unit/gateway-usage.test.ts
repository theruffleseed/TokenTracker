import { describe, expect, it } from "vitest";
import {
  SseUsageCollector,
  usageFromAnthropic,
  usageFromJson,
  usageFromOpenAI,
} from "@/lib/gateway/usage";

describe("usageFromOpenAI", () => {
  it("splits cached input out of prompt tokens", () => {
    const usage = usageFromOpenAI({
      model: "gpt-x",
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 50 },
      },
    });

    expect(usage).toEqual({
      modelId: "gpt-x",
      inputTokens: 600,
      cachedTokens: 400,
      cacheWriteTokens: null,
      outputTokens: 200,
      reasoningTokens: 50,
    });
  });

  it("reads Responses API input/output names", () => {
    const usage = usageFromOpenAI({
      model: "r1",
      usage: {
        input_tokens: 300,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 100 },
        output_tokens_details: { reasoning_tokens: 20 },
      },
    });

    expect(usage).toMatchObject({
      modelId: "r1",
      inputTokens: 200,
      cachedTokens: 100,
      outputTokens: 40,
      reasoningTokens: 20,
    });
  });

  it("returns null when the provider omits usage", () => {
    expect(usageFromOpenAI({ model: "x", choices: [] })).toBeNull();
  });
});

describe("usageFromAnthropic", () => {
  it("keeps cache reads and writes separate from input tokens", () => {
    const usage = usageFromAnthropic({
      model: "claude-x",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
        output_tokens: 120,
      },
    });

    expect(usage).toEqual({
      modelId: "claude-x",
      inputTokens: 100,
      cachedTokens: 900,
      cacheWriteTokens: 50,
      outputTokens: 120,
      reasoningTokens: null,
    });
  });
});

describe("usageFromJson dispatch", () => {
  it("ignores passthrough endpoints", () => {
    expect(
      usageFromJson({ usage: { input_tokens: 1, output_tokens: 1 } }, "passthrough"),
    ).toBeNull();
  });
});

describe("SseUsageCollector", () => {
  it("captures OpenAI usage split across chunk boundaries", () => {
    const collector = new SseUsageCollector("openai_chat", "gpt-fallback");
    const event = `data: ${JSON.stringify({
      model: "gpt-x",
      choices: [{ delta: { content: "hi" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })}\n\n`;
    const cut = 12;
    collector.push(event.slice(0, cut));
    collector.push(event.slice(cut));
    collector.push("data: [DONE]\n\n");

    expect(collector.finish()).toMatchObject({
      modelId: "gpt-x",
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("merges Anthropic message_start and message_delta usage", () => {
    const collector = new SseUsageCollector("anthropic_messages", "fallback");
    collector.push(
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          model: "claude-x",
          usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 1 },
        },
      })}\n\n`,
    );
    collector.push(
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 75 },
      })}\n\n`,
    );

    expect(collector.finish()).toMatchObject({
      modelId: "claude-x",
      inputTokens: 100,
      cachedTokens: 50,
      outputTokens: 75,
    });
  });

  it("reads the Responses API completed event", () => {
    const collector = new SseUsageCollector("openai_responses");
    collector.push(
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          model: "r1",
          usage: { input_tokens: 20, output_tokens: 8, input_tokens_details: { cached_tokens: 5 } },
        },
      })}\n\n`,
    );

    expect(collector.finish()).toMatchObject({
      modelId: "r1",
      inputTokens: 15,
      cachedTokens: 5,
      outputTokens: 8,
    });
  });

  it("returns null when no usage event arrived", () => {
    const collector = new SseUsageCollector("openai_chat");
    collector.push('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
    expect(collector.finish()).toBeNull();
  });
});
