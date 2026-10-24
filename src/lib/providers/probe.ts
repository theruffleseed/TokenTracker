import type {
  AccountSnapshot,
  AdapterContext,
  AdapterResult,
  ProviderAdapter,
  ProviderCapabilities,
  QuotaSnapshotInput,
} from "./types";
import { AdapterError, runAdapter } from "./types";
import { requestJson } from "./http";

export interface ProbeConfig {
  providerId: "TOKENHARBOR" | "RIVER_AI";
  baseUrl: string;
  modelsPath: string;
  credentialLabel: string;
  capabilityNote: string;
  capabilities: ProviderCapabilities;
  ctx: AdapterContext;
}

/**
 * Some vendors expose a documented, billable-safe key check but no balance or
 * quota route. This adapter validates the credential and truthfully reports
 * that no live quota metrics are available; manual snapshots fill the gap.
 */
export class ProbeOnlyAdapter implements ProviderAdapter {
  readonly providerId: ProbeConfig["providerId"];
  readonly capabilities: ProviderCapabilities;

  private probePromise: Promise<AccountSnapshot> | null = null;

  constructor(private readonly config: ProbeConfig) {
    this.providerId = config.providerId;
    this.capabilities = config.capabilities;
  }

  private probe(): Promise<AccountSnapshot> {
    if (!this.probePromise) {
      this.probePromise = this.runProbe().catch((error) => {
        this.probePromise = null;
        throw error;
      });
    }
    return this.probePromise;
  }

  private async runProbe(): Promise<AccountSnapshot> {
    const { ctx, baseUrl, modelsPath, credentialLabel } = this.config;
    if (!ctx.credential) {
      throw new AdapterError("NOT_CONFIGURED", `No ${credentialLabel} is stored`);
    }

    await requestJson(`${baseUrl}${modelsPath}`, {
      headers: { Authorization: `Bearer ${ctx.credential}` },
      timeoutMs: ctx.timeoutMs,
      fetchImpl: ctx.fetchImpl,
      sleepImpl: ctx.sleepImpl,
      retries: 1,
    });

    return {
      accountLabel: ctx.accountLabel,
      planName: ctx.planName,
      planDetails: "Live quota is not exposed; use manual snapshots",
      status: "CONNECTED",
      checkedAt: (ctx.now?.() ?? new Date()).toISOString(),
    };
  }

  validateConnection(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.probe());
  }

  getAccountSnapshot(): Promise<AdapterResult<AccountSnapshot>> {
    return runAdapter(async () => this.probe());
  }

  getQuotaSnapshots(): Promise<AdapterResult<QuotaSnapshotInput[]>> {
    return runAdapter(async () => {
      await this.probe();
      return [];
    }, [this.config.capabilityNote]);
  }
}
