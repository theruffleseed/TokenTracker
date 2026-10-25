import type {
  AccountSnapshot,
  AdapterContext,
  AdapterResult,
  CreditSnapshotInput,
  ProviderAdapter,
  ProviderCapabilities,
  QuotaSnapshotInput,
} from "../types";
import { AdapterError, runAdapter } from "../types";
import { requestJson } from "../http";
import {
  assertJsonResponse,
  isRecord,
  numberAt,
  round,
  stringAt,
} from "../parsing";

const CAPABILITIES: ProviderCapabilities = {
  quotaWindows: [],
  creditBalance: true,
  usageHistory: false,
  modelScopes: false,
  connectionProbe: true,
  experimental: true,
};

const UNLIMITED_LIMIT = 100_000_000;

interface YetaBalance {
  limit: number;
  used: number;
  remaining: number;
  currency: string;
  unlimited: boolean;
}

function rejectApiError(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.error)) return;
  const message = stringAt(value.error, ["message"]) ?? "Yeta returned an error";
  throw new AdapterError("PROVIDER_ERROR", message);
}

export function parseYetaBalance(subscription: unknown, usage: unknown): YetaBalance {
  const subscriptionRoot = isRecord(subscription) && isRecord(subscription.data)
    ? subscription.data
    : subscription;
  const usageRoot = isRecord(usage) && isRecord(usage.data) ? usage.data : usage;

  rejectApiError(subscription);
  rejectApiError(usage);
  if (!isRecord(subscriptionRoot) || !isRecord(usageRoot)) {
    throw new AdapterError("MALFORMED_RESPONSE", "Yeta returned an unrecognized billing payload");
  }

  const limit =
    numberAt(subscriptionRoot, ["hard_limit_usd", "hardLimitUsd"]) ??
    numberAt(subscriptionRoot, ["soft_limit_usd", "softLimitUsd"]) ??
    numberAt(subscriptionRoot, ["system_hard_limit_usd", "systemHardLimitUsd"]);

  if (limit === null || limit < 0) {
    throw new AdapterError("MALFORMED_RESPONSE", "Yeta did not report a billing limit");
  }

  const usageCents = numberAt(usageRoot, ["total_usage", "totalUsage"]);
  if (usageCents === null || usageCents < 0) {
    throw new AdapterError("MALFORMED_RESPONSE", "Yeta did not report total usage");
  }

  const used = usageCents / 100;
  const unlimited = limit >= UNLIMITED_LIMIT;

  return {
    limit: round(limit, 2),
    used: round(used, 2),
    remaining: unlimited ? 0 : round(Math.max(0, limit - used), 2),
    currency: "USD",
    unlimited,
  };
}

export class YetaAdapter implements ProviderAdapter {
  readonly providerId = "YETA" as const;
  readonly capabilities = CAPABILITIES;

  private readonly baseUrl: string;
  private loadPromise: Promise<YetaBalance> | null = null;
  private diagnostics: string[] = [];

  constructor(private readonly ctx: AdapterContext) {
    this.baseUrl = ctx.baseUrl ?? "https://platform.yeta.ai";
  }

  private load(): Promise<YetaBalance> {
    if (!this.loadPromise) {
      this.loadPromise = this.fetchBalance().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  private async fetchBalance(): Promise<YetaBalance> {
    if (!this.ctx.credential) {
      throw new AdapterError("NOT_CONFIGURED", "No Yeta API key is stored");
    }

    const options = {
      headers: { Authorization: `Bearer ${this.ctx.credential}` },
      timeoutMs: this.ctx.timeoutMs,
      fetchImpl: this.ctx.fetchImpl,
      sleepImpl: this.ctx.sleepImpl,
      retries: 1,
    } as const;

    const subscription = await requestJson(
      `${this.baseUrl}/v1/dashboard/billing/subscription`,
      options,
    );
    const usage = await requestJson(`${this.baseUrl}/v1/dashboard/billing/usage`, options);

    const balance = parseYetaBalance(
      assertJsonResponse(subscription),
      assertJsonResponse(usage),
    );

    this.diagnostics = balance.unlimited
      ? ["Yeta reports an unlimited quota token; balance is not meaningful"]
      : [`Yeta balance: $${balance.remaining.toFixed(2)} remaining of $${balance.limit.toFixed(2)}`];

    return balance;
  }

  private snapshot(balance: YetaBalance): AccountSnapshot {
    return {
      accountLabel: this.ctx.accountLabel,
      planName: this.ctx.planName ?? "Yeta",
      planDetails: balance.unlimited
        ? "Unlimited quota token"
        : `$${balance.remaining.toFixed(2)} remaining · $${balance.used.toFixed(2)} used`,
      status: "CONNECTED",
      checkedAt: (this.ctx.now?.() ?? new Date()).toISOString(),
    };
  }

  validateConnection(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.snapshot(await this.load()), () => this.diagnostics);
  }

  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.snapshot(await this.load()), () => this.diagnostics);
  }

  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>> {
    return runAdapter(async () => {
      await this.load();
      return [];
    }, () => this.diagnostics);
  }

  getCreditSnapshots(): Promise<AdapterResult<CreditSnapshotInput[]>> {
    return runAdapter(async () => {
      const balance = await this.load();
      if (balance.unlimited) return [];
      return [
        {
          amount: balance.remaining,
          currency: balance.currency,
          creditType: "WALLET",
          observedAt: (this.ctx.now?.() ?? new Date()).toISOString(),
          source: "live",
        },
      ];
    }, () => this.diagnostics);
  }
}

export const capabilities = CAPABILITIES;
