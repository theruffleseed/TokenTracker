import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AccountSnapshot,
  AdapterContext,
  AdapterResult,
  ProviderAdapter,
  ProviderCapabilities,
  QuotaSnapshotInput,
} from "../types";
import { AdapterError, runAdapter } from "../types";
import { deriveQuota, isRecord, numberAt, stringAt } from "../parsing";

const execFileAsync = promisify(execFile);

const CAPABILITIES: ProviderCapabilities = {
  quotaWindows: ["monthly"],
  creditBalance: false,
  usageHistory: false,
  modelScopes: false,
  connectionProbe: true,
  experimental: true,
};

export interface QoderUsage {
  plan: string | null;
  planCredits: { used: number; total: number } | null;
  addOnCredits: { used: number; total: number } | null;
  expiresAt: string | null;
}

export type QoderUsageRunner = () => Promise<QoderUsage>;

function parseCredits(value: unknown): { used: number; total: number } | null {
  if (!isRecord(value)) return null;
  const used = numberAt(value, ["used"]);
  const total = numberAt(value, ["total"]);
  if (used === null || total === null || used < 0 || total < 0) return null;
  return { used, total };
}

function normalizeUsage(value: unknown): QoderUsage {
  if (!isRecord(value)) {
    throw new AdapterError("MALFORMED_RESPONSE", "The Qoder CLI returned an unrecognized payload");
  }

  const error = stringAt(value, ["error"]);
  if (error) {
    throw new AdapterError(
      /not signed in|login/i.test(error) ? "NOT_CONFIGURED" : "PROVIDER_ERROR",
      error,
    );
  }

  const expiresAt = stringAt(value, ["expiresAt"]);
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    throw new AdapterError("MALFORMED_RESPONSE", "The Qoder CLI returned an invalid expiry date");
  }

  return {
    plan: stringAt(value, ["plan"]),
    planCredits: parseCredits(value.planCredits),
    addOnCredits: parseCredits(value.addOnCredits),
    expiresAt,
  };
}

export async function runQoderCliUsage(): Promise<QoderUsage> {
  const script =
    process.env.QODER_CLI_SCRIPT ?? path.join(process.cwd(), "scripts/qoder-cli-usage.py");

  try {
    const { stdout } = await execFileAsync("python3", [script], {
      timeout: 60_000,
      maxBuffer: 1_000_000,
      cwd: process.cwd(),
    });
    return normalizeUsage(JSON.parse(stdout.trim()));
  } catch (error) {
    if (error instanceof AdapterError) throw error;

    const failure = error as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };

    if (failure.killed || failure.signal) {
      throw new AdapterError("TIMEOUT", "The Qoder CLI usage check timed out");
    }

    const raw = (failure.stdout ?? "").trim();
    if (raw) {
      try {
        return normalizeUsage(JSON.parse(raw));
      } catch (parsedError) {
        if (parsedError instanceof AdapterError) throw parsedError;
      }
    }

    throw new AdapterError("PROVIDER_ERROR", "Could not read usage from the Qoder CLI", {
      diagnostics: failure.stderr ? [failure.stderr.slice(0, 200)] : [],
    });
  }
}

function mapUsage(usage: QoderUsage, now: Date): QuotaSnapshotInput[] {
  const observedAt = now.toISOString();
  const rows: QuotaSnapshotInput[] = [];

  if (usage.planCredits && usage.planCredits.total > 0) {
    const derived = deriveQuota({
      limit: usage.planCredits.total,
      used: usage.planCredits.used,
      remaining: Math.max(0, usage.planCredits.total - usage.planCredits.used),
      remainingPercent: null,
    });
    rows.push({
      window: "monthly",
      unit: "credits",
      ...derived,
      resetsAt: usage.expiresAt,
      observedAt,
      modelScope: null,
      source: "live",
    });
  }

  if (usage.addOnCredits && usage.addOnCredits.total > 0) {
    const derived = deriveQuota({
      limit: usage.addOnCredits.total,
      used: usage.addOnCredits.used,
      remaining: Math.max(0, usage.addOnCredits.total - usage.addOnCredits.used),
      remainingPercent: null,
    });
    rows.push({
      window: "monthly",
      unit: "credits",
      ...derived,
      resetsAt: null,
      observedAt,
      modelScope: "Add-on credits",
      source: "live",
    });
  }

  return rows;
}

export class QoderAdapter implements ProviderAdapter {
  readonly providerId = "QODER" as const;
  readonly capabilities = CAPABILITIES;

  private loadPromise: Promise<QoderUsage> | null = null;
  private diagnostics: string[] = [];

  constructor(
    private readonly ctx: AdapterContext,
    private readonly runner: QoderUsageRunner = runQoderCliUsage,
  ) {}

  private load(): Promise<QoderUsage> {
    if (!this.loadPromise) {
      this.loadPromise = this.runner().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  private snapshot(usage: QoderUsage): AccountSnapshot {
    const planCredits = usage.planCredits;
    const planDetails =
      planCredits && planCredits.total > 0
        ? [
            `${usage.plan ?? "Qoder"} · ${planCredits.used}/${planCredits.total} credits`,
            usage.expiresAt ? `resets ${usage.expiresAt.slice(0, 10)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : `${usage.plan ?? "Qoder"} plan · no plan credits`;

    return {
      accountLabel: this.ctx.accountLabel,
      planName: this.ctx.planName ?? usage.plan,
      planDetails,
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
      const usage = await this.load();
      const rows = mapUsage(usage, this.ctx.now?.() ?? new Date());
      this.diagnostics = rows.length === 0 ? ["Qoder reports no plan credits"] : [];
      return rows;
    }, () => this.diagnostics);
  }
}

export const capabilities = CAPABILITIES;
