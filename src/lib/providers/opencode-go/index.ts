import type {
  AccountSnapshot,
  AdapterContext,
  AdapterResult,
  ProviderAdapter,
  ProviderCapabilities,
  QuotaSnapshotInput,
} from "../types";
import { AdapterError, runAdapter } from "../types";
import { requestJson } from "../http";
import { assertJsonResponse, atPath, dateAt, isRecord, numberAt, stringAt } from "../parsing";

const CAPABILITIES: ProviderCapabilities = {
  quotaWindows: ["rolling_5h", "weekly", "monthly"],
  creditBalance: false,
  usageHistory: false,
  modelScopes: false,
  connectionProbe: true,
  experimental: true,
};

const WINDOWS = [
  {
    window: "rolling_5h" as const,
    paths: ["usage.rolling", "rolling", "usage.fiveHour", "fiveHour", "usage.five_hour", "usage.5h"],
  },
  { window: "weekly" as const, paths: ["usage.weekly", "weekly"] },
  { window: "monthly" as const, paths: ["usage.monthly", "monthly"] },
  { window: "daily" as const, paths: ["usage.daily", "daily"] },
];

export interface OpenCodeParsed {
  quota: QuotaSnapshotInput[];
  accountLabel: string | null;
  planName: string | null;
  diagnostics: string[];
}

/**
 * Parses the Go subscription meters. The observed shape is:
 * { usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }
 * with defensive support for bare windows, used/limit pairs and relative
 * reset seconds. Missing windows are omitted, never filled with zero.
 */
export function parseOpenCodeUsage(data: unknown, now: Date): OpenCodeParsed {
  const diagnostics: string[] = [];
  const quota: QuotaSnapshotInput[] = [];
  const observedAt = now.toISOString();

  const root = isRecord(atPath(data, ["usage"])) ? atPath(data, ["usage"]) : data;

  for (const candidate of WINDOWS) {
    const raw = firstRecord(root, candidate.paths);
    if (!raw) continue;

    const usedPercent = numberAt(raw, [
      "percentUsed",
      "usedPercent",
      "used_percent",
      "percent",
      "utilization",
    ]);
    const remainingPercentRaw = numberAt(raw, ["remainingPercent", "percentRemaining"]);
    const limit = numberAt(raw, ["limit", "cap", "quota"]);
    const used = numberAt(raw, ["used", "usage", "consumed"]);
    const remaining = numberAt(raw, ["remaining", "left"]);

    let remainingPercent =
      remainingPercentRaw ??
      (usedPercent !== null
        ? 100 - usedPercent
        : limit !== null && used !== null && limit > 0
          ? ((limit - used) / limit) * 100
          : null);

    if (remainingPercent === null && remaining !== null && limit !== null && limit > 0) {
      remainingPercent = (remaining / limit) * 100;
    }

    if (
      usedPercent === null &&
      used === null &&
      remaining === null &&
      limit === null &&
      remainingPercent === null
    ) {
      diagnostics.push(`Unrecognized ${candidate.window} meter payload`);
      continue;
    }

    const clampedPercent =
      remainingPercent === null ? null : Math.min(100, Math.max(0, remainingPercent));

    quota.push({
      window: candidate.window,
      unit: "percent",
      limit: limit ?? 100,
      used:
        used ??
        (usedPercent !== null ? usedPercent : limit !== null && clampedPercent !== null
          ? Math.max(0, limit - (clampedPercent / 100) * limit)
          : null),
      remaining:
        remaining ??
        (clampedPercent !== null && (limit ?? 100) > 0
          ? Math.round(((clampedPercent / 100) * (limit ?? 100)) * 10_000) / 10_000
          : null),
      remainingPercent: clampedPercent,
      resetsAt:
        dateAt(raw, ["resetsAt", "resetAt", "resets_at", "reset_at"], { now }) ??
        dateAt(raw, ["resetsInSeconds", "resetInSeconds", "resets_in_seconds"], {
          relativeSeconds: true,
          now,
        }),
      observedAt,
      modelScope: null,
      source: "live",
    });
  }

  if (quota.length === 0) {
    throw new AdapterError("MALFORMED_RESPONSE", "No recognizable Go quota windows were returned", {
      diagnostics,
    });
  }

  return {
    quota,
    accountLabel: stringAt(data, [
      "email",
      "account.email",
      "user.email",
      "workspace.name",
      "workspaceName",
      "accountName",
    ]),
    planName: stringAt(data, ["planName", "plan.name", "plan", "subscription.plan"]),
    diagnostics,
  };
}

function firstRecord(root: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = atPath(root, path.split("."));
    if (isRecord(value)) return value;
  }
  return null;
}

export class OpenCodeGoAdapter implements ProviderAdapter {
  readonly providerId = "OPENCODE_GO" as const;
  readonly capabilities = CAPABILITIES;

  private readonly baseUrl: string;
  private loadPromise: Promise<OpenCodeParsed> | null = null;

  constructor(private readonly ctx: AdapterContext) {
    this.baseUrl = ctx.baseUrl ?? "https://opencode.ai";
  }

  private load(): Promise<OpenCodeParsed> {
    if (!this.loadPromise) {
      this.loadPromise = this.fetchUsage().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  private async fetchUsage(): Promise<OpenCodeParsed> {
    if (!this.ctx.credential) {
      throw new AdapterError("NOT_CONFIGURED", "No OpenCode Go API key is stored");
    }

    const response = await requestJson(`${this.baseUrl}/zen/go/v1/usage`, {
      headers: { Authorization: `Bearer ${this.ctx.credential}` },
      timeoutMs: this.ctx.timeoutMs,
      fetchImpl: this.ctx.fetchImpl,
      sleepImpl: this.ctx.sleepImpl,
      retries: 1,
    });

    return parseOpenCodeUsage(assertJsonResponse(response), this.ctx.now?.() ?? new Date());
  }

  validateConnection(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.toAccount(await this.load()));
  }

  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.toAccount(await this.load()));
  }

  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>> {
    return runAdapter(async () => {
      const parsed = await this.load();
      return parsed.quota.map((snapshot) => ({
        ...snapshot,
        modelScope: snapshot.modelScope ?? null,
      }));
    });
  }

  private toAccount(parsed: OpenCodeParsed): AccountSnapshot {
    return {
      accountLabel: parsed.accountLabel ?? this.ctx.accountLabel,
      planName: parsed.planName ?? this.ctx.planName,
      planDetails: null,
      status: "CONNECTED",
      checkedAt: (this.ctx.now?.() ?? new Date()).toISOString(),
    };
  }
}
