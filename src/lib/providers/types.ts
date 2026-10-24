import type { ProviderKey, QuotaUnitKey, QuotaWindowKey } from "../schemas";

export type DataSourceKey = "live" | "manual" | "cached" | "estimated";

export type CreditTypeKey =
  | "WALLET"
  | "PROMOTIONAL"
  | "REWARD"
  | "INCLUDED_ALLOWANCE"
  | "OTHER";

export interface QuotaSnapshotInput {
  window: QuotaWindowKey;
  unit: QuotaUnitKey;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  observedAt: string;
  modelScope: string | null;
  source: DataSourceKey;
}

export interface CreditSnapshotInput {
  amount: number;
  currency: string;
  creditType: CreditTypeKey;
  observedAt: string;
  source: DataSourceKey;
}

export interface UsageRecordInput {
  occurredAt: string;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
  currency: string | null;
  source: DataSourceKey;
  externalId: string | null;
}

export interface AccountSnapshot {
  accountLabel: string | null;
  planName: string | null;
  planDetails: string | null;
  status: "CONNECTED" | "NEEDS_ATTENTION";
  checkedAt: string;
}

export type AdapterErrorCode =
  | "INVALID_CREDENTIALS"
  | "EXPIRED_CREDENTIALS"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE"
  | "UNSUPPORTED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export interface AdapterErrorPayload {
  code: AdapterErrorCode;
  message: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
  diagnostics?: string[];
}

export type AdapterResult<T> =
  | { ok: true; data: T; diagnostics?: string[] }
  | { ok: false; error: AdapterErrorPayload; diagnostics?: string[] };

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
  readonly diagnostics?: string[];

  constructor(
    code: AdapterErrorCode,
    message: string,
    options: {
      httpStatus?: number;
      retryAfterSeconds?: number;
      diagnostics?: string[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdapterError";
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.diagnostics = options.diagnostics;
  }

  toPayload(): AdapterErrorPayload {
    return {
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryAfterSeconds: this.retryAfterSeconds,
      diagnostics: this.diagnostics,
    };
  }
}

export interface ProviderCapabilities {
  quotaWindows: QuotaWindowKey[];
  creditBalance: boolean;
  usageHistory: boolean;
  modelScopes: boolean;
  /** A read-only probe exists that can validate a credential. */
  connectionProbe: boolean;
  /** Data comes from a route outside the vendor's documented public API. */
  experimental: boolean;
}

export interface AdapterContext {
  credential: string | null;
  accountLabel: string | null;
  planName: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  baseUrl?: string;
  /** Injectable sleep for bounded-retry tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface ProviderAdapter {
  readonly providerId: ProviderKey;
  readonly capabilities: ProviderCapabilities;

  validateConnection(): Promise<AdapterResult<AccountSnapshot>>;
  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>>;
  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>>;
  getCreditSnapshots?(): Promise<AdapterResult<CreditSnapshotInput[]>>;
  getUsageHistory?(since: string): Promise<AdapterResult<UsageRecordInput[]>>;
}

export async function runAdapter<T>(
  fn: () => Promise<T>,
  diagnostics: string[] | (() => string[]) = [],
): Promise<AdapterResult<T>> {
  const resolve = () => (typeof diagnostics === "function" ? diagnostics() : diagnostics);

  try {
    return { ok: true, data: await fn(), diagnostics: resolve() };
  } catch (error) {
    if (error instanceof AdapterError) {
      return {
        ok: false,
        error: error.toPayload(),
        diagnostics: [...resolve(), ...(error.diagnostics ?? [])],
      };
    }

    return {
      ok: false,
      error: {
        code: "UNKNOWN",
        message: "The provider returned an unexpected error",
      },
      diagnostics: [...resolve(), error instanceof Error ? error.message : "unknown"],
    };
  }
}
