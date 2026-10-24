import type { ProviderKey } from "../schemas";

/**
 * Public list prices, in USD per one million tokens. Neither vendor exposes a
 * per-account cost API, so gateway spend is an estimate against these lists.
 */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  free: boolean;
}

export type PriceTable = Map<string, ModelPrice>;

export interface BillableUsage {
  inputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
}

const PRICE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

const cache = new Map<
  ProviderKey,
  { expiresAt: number; table: PriceTable | null; complete: boolean }
>();
const inflight = new Map<ProviderKey, Promise<PriceTable | null>>();

function finitePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Model IDs vary by namespace (`anthropic/claude-…`), variant suffix
 * (`…:free`) and case. Index every reasonable spelling of the same model.
 */
export function modelKeys(modelId: string): string[] {
  const lower = modelId.trim().toLowerCase();
  if (!lower) return [];
  const keys = new Set<string>([lower]);
  const tail = lower.split("/").pop();
  if (tail) keys.add(tail);
  const withoutVariant = lower.replace(/[:@][^:@/]+$/, "");
  keys.add(withoutVariant);
  const variantTail = withoutVariant.split("/").pop();
  if (variantTail) keys.add(variantTail);
  return [...keys];
}

function addPrice(table: PriceTable, modelId: unknown, price: ModelPrice): void {
  if (typeof modelId !== "string" || !modelId.trim()) return;
  for (const key of modelKeys(modelId)) {
    if (!table.has(key)) table.set(key, price);
  }
}

export function findPrice(table: PriceTable | null, modelId: string | null): ModelPrice | null {
  if (!table || !modelId) return null;
  for (const key of modelKeys(modelId)) {
    const match = table.get(key);
    if (match) return match;
  }
  return null;
}

function extractArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * TokenHarbor publishes its live rate card inside the models page's Next.js
 * flight payload. Only these public list fields are read.
 */
export function parseTokenHarborPricing(html: string): PriceTable {
  const table: PriceTable = new Map();
  const unescaped = html.replace(/\\"/g, '"');
  const marker = unescaped.indexOf('"rows":[');
  if (marker < 0) return table;

  const start = unescaped.indexOf("[", marker);
  if (start < 0) return table;
  const raw = extractArray(unescaped, start);
  if (!raw) return table;

  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return table;
  }
  if (!Array.isArray(rows)) return table;

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const free = record.isFree === true;
    const input = finitePrice(record.priceIn);
    const output = finitePrice(record.priceOut);
    if (input === null || output === null) continue;

    const cache = record.cache;
    const cacheRead =
      typeof cache === "object" && cache !== null
        ? finitePrice((cache as Record<string, unknown>).read)
        : null;
    const cacheWrite =
      typeof cache === "object" && cache !== null
        ? finitePrice((cache as Record<string, unknown>).write)
        : null;

    const price: ModelPrice = {
      input: free ? 0 : input,
      cachedInput: free ? 0 : cacheRead ?? input,
      cacheWrite: free ? 0 : cacheWrite ?? input,
      output: free ? 0 : output,
      free,
    };
    addPrice(table, record.surface, price);

    const speed = record.speedBuild;
    if (typeof speed === "object" && speed !== null) {
      const fast = speed as Record<string, unknown>;
      const fastInput = finitePrice(fast.priceIn);
      const fastOutput = finitePrice(fast.priceOut);
      if (fastInput !== null && fastOutput !== null) {
        addPrice(table, fast.surface, {
          input: fastInput,
          cachedInput: fastInput,
          cacheWrite: fastInput,
          output: fastOutput,
          free: false,
        });
      }
    }
  }

  return table;
}

/**
 * TokenHarbor's authenticated models response includes the same rate card for
 * every callable model. The public models page lags behind it, so prefer this
 * source whenever a provider key is available.
 */
export function parseTokenHarborModelsPricing(payload: unknown): PriceTable {
  const table: PriceTable = new Map();
  if (typeof payload !== "object" || payload === null) return table;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return table;

  for (const row of data) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const price = record.pricing;
    if (typeof price !== "object" || price === null) continue;
    const rates = price as Record<string, unknown>;
    const input = finitePrice(rates.input_usd_per_1m);
    const output = finitePrice(rates.output_usd_per_1m);
    if (input === null || output === null) continue;

    const free = input === 0 && output === 0;
    addPrice(table, record.id, {
      input: free ? 0 : input,
      cachedInput: free ? 0 : finitePrice(rates.cache_read_usd_per_1m) ?? input,
      cacheWrite: free ? 0 : finitePrice(rates.cache_write_usd_per_1m) ?? input,
      output: free ? 0 : output,
      free,
    });
  }

  return table;
}

/** River's public pricing JSON lists per-million-token rates per model. */
export function parseRiverPricing(payload: unknown): PriceTable {
  const table: PriceTable = new Map();
  if (typeof payload !== "object" || payload === null) return table;
  const inference = (payload as Record<string, unknown>).inference;
  if (!Array.isArray(inference)) return table;

  for (const row of inference) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const input = finitePrice(record.input);
    const output = finitePrice(record.output);
    if (input === null || output === null) continue;
    const cached = finitePrice(record.cached_input) ?? input;
    addPrice(table, record.model, {
      input,
      cachedInput: cached,
      cacheWrite: input,
      output,
      free: input === 0 && output === 0,
    });
  }

  return table;
}

interface FetchedPrices {
  table: PriceTable;
  /** False when an incomplete source (the public page) was used. */
  complete: boolean;
}

async function fetchTable(provider: ProviderKey, apiKey?: string): Promise<FetchedPrices> {
  const signal = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (provider === "RIVER_AI") {
    const response = await fetch("https://console.river.ai/api/public/pricing", {
      headers: { Accept: "application/json", "User-Agent": "TokenTracker-Gateway/0.1" },
      signal: signal(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`pricing HTTP ${response.status}`);
    return { table: parseRiverPricing(await response.json()), complete: true };
  }

  if (provider === "TOKENHARBOR") {
    if (apiKey) {
      try {
        const response = await fetch("https://tokenharbor.ai/v1/models", {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "User-Agent": "TokenTracker-Gateway/0.1",
          },
          signal: signal(),
          cache: "no-store",
        });
        if (response.ok) {
          const table = parseTokenHarborModelsPricing(await response.json());
          if (table.size > 0) return { table, complete: true };
        }
      } catch {
        // Fall through to the public page.
      }
    }

    const response = await fetch("https://tokenharbor.ai/models", {
      headers: { Accept: "text/html", "User-Agent": "TokenTracker-Gateway/0.1" },
      signal: signal(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`pricing HTTP ${response.status}`);
    return { table: parseTokenHarborPricing(await response.text()), complete: false };
  }

  return { table: new Map(), complete: false };
}

/**
 * Cached public price table. Pricing failures never block inference; they only
 * leave the request's cost unset. A provider key upgrades TokenHarbor from the
 * incomplete public page to its full authenticated catalog.
 */
export async function getPricing(
  provider: ProviderKey,
  options: { now?: () => number; apiKey?: string } = {},
): Promise<PriceTable | null> {
  const now = options.now?.() ?? Date.now();
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > now) {
    const upgradable =
      provider === "TOKENHARBOR" &&
      Boolean(options.apiKey) &&
      !cached.complete &&
      cached.table !== null;
    if (!upgradable) return cached.table;
  }

  const existing = inflight.get(provider);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { table, complete } = await fetchTable(provider, options.apiKey);
      if (table.size === 0) throw new Error("pricing table was empty");
      cache.set(provider, { expiresAt: now + PRICE_TTL_MS, table, complete });
      return table;
    } catch (error) {
      console.warn(
        `[gateway] pricing unavailable for ${provider}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      cache.set(provider, { expiresAt: now + FAILURE_TTL_MS, table: null, complete: false });
      return null;
    } finally {
      inflight.delete(provider);
    }
  })();

  inflight.set(provider, promise);
  return promise;
}

export function invalidatePricingCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

function tokenCount(value: number | null): number {
  return value !== null && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Cost in USD for one request. Cached input is charged at the cached rate and
 * cache writes at the write rate when the vendor publishes one.
 */
export function estimateCost(price: ModelPrice | null, usage: BillableUsage): number | null {
  if (!price) return null;
  if (price.free) return 0;

  const input = tokenCount(usage.inputTokens);
  const cached = tokenCount(usage.cachedTokens);
  const cacheWrite = tokenCount(usage.cacheWriteTokens);
  const output = tokenCount(usage.outputTokens);

  const cost =
    (input * price.input +
      cached * price.cachedInput +
      cacheWrite * price.cacheWrite +
      output * price.output) /
    1_000_000;

  if (!Number.isFinite(cost) || cost < 0) return null;
  return Math.round(cost * 1e10) / 1e10;
}
