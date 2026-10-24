import { describe, expect, it } from "vitest";
import {
  estimateCost,
  findPrice,
  modelKeys,
  parseRiverPricing,
  parseTokenHarborPricing,
} from "@/lib/gateway/pricing";

function tokenHarborHtml(rows: unknown[]): string {
  const payload = `1e:["$","div",null,{"rows":${JSON.stringify(rows)}}]`;
  return `<html><script>self.__next_f.push([1,"${payload.replace(/"/g, '\\"')}"])</script></html>`;
}

describe("parseTokenHarborPricing", () => {
  const html = tokenHarborHtml([
    {
      surface: "claude-opus-5.5",
      priceIn: 4,
      priceOut: 20,
      isFree: false,
      cache: { read: 0.2, write: 5 },
      speedBuild: { surface: "claude-opus-5.5-fast", priceIn: 8, priceOut: 40 },
    },
    {
      surface: "free-model",
      priceIn: 99,
      priceOut: 99,
      isFree: true,
    },
  ]);

  it("reads public list rates, cache rates and speed variants", () => {
    const table = parseTokenHarborPricing(html);
    const opus = findPrice(table, "claude-opus-5.5");
    expect(opus).toEqual({
      input: 4,
      cachedInput: 0.2,
      cacheWrite: 5,
      output: 20,
      free: false,
    });

    const fast = findPrice(table, "claude-opus-5.5-fast");
    expect(fast?.input).toBe(8);
    expect(fast?.output).toBe(40);
  });

  it("zeroes free models instead of trusting placeholder prices", () => {
    const table = parseTokenHarborPricing(html);
    expect(findPrice(table, "free-model")).toMatchObject({
      input: 0,
      cachedInput: 0,
      output: 0,
      free: true,
    });
  });

  it("returns an empty table when the page shape changes", () => {
    expect(parseTokenHarborPricing("<html>nothing here</html>").size).toBe(0);
    expect(parseTokenHarborPricing('<script>self.__next_f.push([1,"{\\"rows\\":oops}"])</script>').size).toBe(0);
  });
});

describe("parseRiverPricing", () => {
  it("uses only inference rates, not training rates", () => {
    const table = parseRiverPricing({
      inference: [
        { model: "Qwen/Qwen3.8-27B-FP8", input: 0.1, cached_input: 0.02, output: 2 },
      ],
      training_and_sampling: [
        { model: "Qwen/Qwen3.8-27B-FP8", sampling: { input: 1.8, cached_input: 0.36, output: 5.5 }, training: 4 },
      ],
    });

    expect(findPrice(table, "Qwen/Qwen3.8-27B-FP8")).toMatchObject({
      input: 0.1,
      cachedInput: 0.02,
      output: 2,
    });
  });

  it("matches namespaced and variant model IDs", () => {
    expect(modelKeys("anthropic/claude-sonnet-5.5:free")).toEqual(
      expect.arrayContaining(["anthropic/claude-sonnet-5.5:free", "claude-sonnet-5.5:free", "anthropic/claude-sonnet-5.5", "claude-sonnet-5.5"]),
    );
  });
});

describe("estimateCost", () => {
  const price = { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20, free: false };

  it("prices regular, cached and cache-write input separately", () => {
    const cost = estimateCost(price, {
      inputTokens: 1_000_000,
      cachedTokens: 500_000,
      cacheWriteTokens: 100_000,
      outputTokens: 250_000,
    });
    // 4 + 0.1 + 0.5 + 5 = 9.6
    expect(cost).toBeCloseTo(9.6, 10);
  });

  it("returns zero for free models and null without a price", () => {
    expect(
      estimateCost(
        { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, free: true },
        { inputTokens: 900, cachedTokens: null, cacheWriteTokens: null, outputTokens: 100 },
      ),
    ).toBe(0);
    expect(
      estimateCost(null, { inputTokens: 1, cachedTokens: null, cacheWriteTokens: null, outputTokens: 1 }),
    ).toBeNull();
  });
});
