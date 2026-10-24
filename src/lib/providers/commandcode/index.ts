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
import { requestJson, type JsonResponse } from "../http";
import {
  assertJsonResponse,
  atPath,
  dateAt,
  deriveQuota,
  isRecord,
  numberAt,
  stringAt,
} from "../parsing";

const CAPABILITIES: ProviderCapabilities = {
  quotaWindows: ["rolling_5h", "weekly", "monthly"],
  creditBalance: true,
  usageHistory: false,
  modelScopes: false,
  connectionProbe: true,
  experimental: true,
};

export interface CommandCodeParsed {
  quota: QuotaSnapshotInput[];
  credits: CreditSnapshotInput[];
  accountLabel: string | null;
  planName: string | null;
  planDetails: string | null;
  diagnostics: string[];
}

/**
 * Command Code's billing payload is an alpha CLI contract. These helpers read
 * several plausible field names but never invent a value: anything absent
 * stays null. Fixtures in tests are synthetic, not captured customer data.
 */
export function parseCommandCodeBilling(input: {
  credits: unknown;
  subscription?: unknown;
  whoami?: unknown;
  now: Date;
}): CommandCodeParsed {
  const diagnostics: string[] = [];
  const nowIso = input.now.toISOString();
  const envelope = unwrapEnvelope(input.credits);
  const root = unwrap(input.credits);
  const quota: QuotaSnapshotInput[] = [];
  const credits: CreditSnapshotInput[] = [];

  const monthlyGrant = numberAt(root, [
    "monthlyCreditsGranted",
    "monthlyGrant",
    "monthlyCreditsLimit",
    "planCredits",
    "includedCredits",
    "monthlyLimit",
  ]);
  const monthlyRemaining = numberAt(root, [
    "monthlyCredits",
    "monthlyCreditsRemaining",
    "remainingMonthlyCredits",
    "includedCreditsRemaining",
  ]);

  if (monthlyGrant !== null || monthlyRemaining !== null) {
    const derived = deriveQuota({
      limit: monthlyGrant,
      used: null,
      remaining: monthlyRemaining,
      remainingPercent: null,
    });
    quota.push({
      window: "monthly",
      unit: "usd",
      ...derived,
      resetsAt: dateAt(unwrap(input.subscription), [
        "currentPeriodEnd",
        "billingPeriodEnd",
        "periodEnd",
        "renewsAt",
      ]),
      observedAt: nowIso,
      modelScope: null,
      source: "live",
    });
  } else {
    diagnostics.push("No monthly credit grant in billing payload");
  }

  const windows = [
    {
      window: "rolling_5h" as const,
      paths: ["windowLimits.fiveHour", "windowLimits.five_hour", "windowLimits.5h", "rollings.fiveHour"],
    },
    {
      window: "weekly" as const,
      paths: ["windowLimits.weekly", "windowLimits.week", "rollings.weekly"],
    },
  ];

  for (const candidate of windows) {
    // Live responses put windowLimits beside the credits object; older payloads
    // nest it inside. Check both without flattening the envelope.
    const raw =
      firstRecord(root, candidate.paths) ?? firstRecord(envelope, candidate.paths);
    if (!raw) {
      diagnostics.push(`No ${candidate.window} window in billing payload`);
      continue;
    }

    const limit = numberAt(raw, ["cap", "limit", "max", "allocation"]);
    const used = numberAt(raw, ["used", "spent", "usage"]);
    const remaining = numberAt(raw, ["remaining", "left"]);
    const percent = numberAt(raw, ["remainingPercent", "percentRemaining"]);
    const usedPercent = numberAt(raw, ["usedPercent", "percentUsed", "percent"]);

    const derived = deriveQuota({
      limit,
      used,
      remaining,
      remainingPercent:
        percent ?? (usedPercent !== null ? 100 - usedPercent : null),
    });

    if (limit === null && used === null && remaining === null && derived.remainingPercent === null) {
      diagnostics.push(`Unrecognized ${candidate.window} window payload`);
      continue;
    }

    quota.push({
      window: candidate.window,
      unit: "usd",
      ...derived,
      resetsAt: dateAt(raw, ["resetAt", "resetsAt", "reset_at"], { now: input.now }),
      observedAt: nowIso,
      modelScope: null,
      source: "live",
    });
  }

  const purchased = numberAt(root, ["purchasedCredits", "extraCredits", "purchased_credits", "topUpCredits"]);
  const free = numberAt(root, ["freeCredits", "free_credits", "rewardCredits"]);
  const currency = "USD";

  if (purchased !== null) {
    credits.push({
      amount: purchased,
      currency,
      creditType: "WALLET",
      observedAt: nowIso,
      source: "live",
    });
  }
  if (free !== null) {
    credits.push({
      amount: free,
      currency,
      creditType: "REWARD",
      observedAt: nowIso,
      source: "live",
    });
  }

  const sub = firstSubscription(input.subscription);
  const who = unwrap(input.whoami);
  const rawPlan = stringAt(sub, ["planName", "plan.name", "planId", "plan.id", "tier"]) ??
    stringAt(root, ["planName", "plan", "planId"]);

  const accountLabel =
    stringAt(who, ["email", "user.email", "username", "user.username", "name", "user.name"]) ??
    stringAt(root, ["email", "account.email", "username"]);

  return {
    quota,
    credits,
    accountLabel,
    planName: prettyPlanName(rawPlan),
    planDetails: buildPlanDetails(sub),
    diagnostics,
  };
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.data)) return value.data;
  if (isRecord(value.credits)) return value.credits;
  return value;
}

function unwrapEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.data)) return value.data;
  return value;
}

function firstRecord(root: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = atPath(root, path.split("."));
    if (isRecord(value)) return value;
  }
  return null;
}

function firstSubscription(value: unknown): unknown {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) return unwrapped[0] ?? null;
  if (isRecord(unwrapped) && Array.isArray(unwrapped.subscriptions)) {
    return unwrapped.subscriptions[0] ?? null;
  }
  return unwrapped;
}

function prettyPlanName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^individual[-_]/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return cleaned || raw;
}

function buildPlanDetails(sub: unknown): string | null {
  if (!isRecord(sub)) return null;
  const status = stringAt(sub, ["status", "subscriptionStatus"]);
  const end = dateAt(sub, ["currentPeriodEnd", "billingPeriodEnd", "periodEnd"]);
  const parts = [status, end ? `Renews ${end.slice(0, 10)}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export class CommandCodeAdapter implements ProviderAdapter {
  readonly providerId = "COMMANDCODE" as const;
  readonly capabilities = CAPABILITIES;

  private readonly baseUrl: string;
  private loadPromise: Promise<CommandCodeParsed> | null = null;
  private lastDiagnostics: string[] = [];

  constructor(private readonly ctx: AdapterContext) {
    this.baseUrl = ctx.baseUrl ?? "https://api.commandcode.ai";
  }

  private load(): Promise<CommandCodeParsed> {
    if (!this.loadPromise) {
      this.loadPromise = this.fetchBilling().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  private async fetchBilling(): Promise<CommandCodeParsed> {
    if (!this.ctx.credential) {
      throw new AdapterError("NOT_CONFIGURED", "No Command Code API key is stored");
    }

    const headers = {
      Authorization: `Bearer ${this.ctx.credential}`,
      "Content-Type": "application/json",
    };
    const options = {
      headers,
      timeoutMs: this.ctx.timeoutMs,
      fetchImpl: this.ctx.fetchImpl,
      sleepImpl: this.ctx.sleepImpl,
      retries: 1,
    } as const;

    const creditsResponse = await requestJson(
      `${this.baseUrl}/alpha/billing/credits`,
      options,
    );
    const credits = assertJsonResponse(creditsResponse);

    const diagnostics: string[] = [];
    const subscription = await this.optionalRequest(
      `${this.baseUrl}/alpha/billing/subscriptions`,
      options,
      diagnostics,
    );
    const whoami = await this.optionalRequest(
      `${this.baseUrl}/alpha/whoami?limits=1`,
      options,
      diagnostics,
    );

    try {
      const parsed = parseCommandCodeBilling({
        credits,
        subscription,
        whoami,
        now: this.ctx.now?.() ?? new Date(),
      });
      this.lastDiagnostics = [...diagnostics, ...parsed.diagnostics];
      return parsed;
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new AdapterError(error.code, error.message, {
          httpStatus: error.httpStatus,
          retryAfterSeconds: error.retryAfterSeconds,
          diagnostics: [...diagnostics, ...(error.diagnostics ?? [])],
          cause: error,
        });
      }
      throw error;
    }
  }

  private async optionalRequest(
    url: string,
    options: Parameters<typeof requestJson>[1],
    diagnostics: string[],
  ): Promise<unknown> {
    try {
      const response: JsonResponse = await requestJson(url, options);
      return response.data;
    } catch (error) {
      if (error instanceof AdapterError) {
        if (error.code === "INVALID_CREDENTIALS" || error.code === "FORBIDDEN") throw error;
        diagnostics.push(`Optional lookup failed: ${error.code}`);
        return null;
      }
      diagnostics.push("Optional lookup failed");
      return null;
    }
  }

  validateConnection(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(
      async () => this.toAccount(await this.load()),
      () => this.lastDiagnostics,
    );
  }

  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(
      async () => this.toAccount(await this.load()),
      () => this.lastDiagnostics,
    );
  }

  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>> {
    return runAdapter(
      async () => (await this.load()).quota,
      () => this.lastDiagnostics,
    );
  }

  getCreditSnapshots(): Promise<AdapterResult<CreditSnapshotInput[]>> {
    return runAdapter(
      async () => (await this.load()).credits,
      () => this.lastDiagnostics,
    );
  }

  private toAccount(parsed: CommandCodeParsed): AccountSnapshot {
    return {
      accountLabel: parsed.accountLabel ?? this.ctx.accountLabel,
      planName: parsed.planName ?? this.ctx.planName,
      planDetails: parsed.planDetails,
      status: "CONNECTED",
      checkedAt: (this.ctx.now?.() ?? new Date()).toISOString(),
    };
  }
}
