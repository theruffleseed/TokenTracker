import type { AdapterContext } from "../types";
import { ProbeOnlyAdapter } from "../probe";
import type { ProviderCapabilities } from "../types";

const CAPABILITIES: ProviderCapabilities = {
  quotaWindows: [],
  creditBalance: false,
  usageHistory: false,
  modelScopes: false,
  connectionProbe: true,
  experimental: false,
};

export class RiverAiAdapter extends ProbeOnlyAdapter {
  constructor(ctx: AdapterContext) {
    super({
      providerId: "RIVER_AI",
      baseUrl: ctx.baseUrl ?? "https://api.river.ai",
      modelsPath: "/v1/models",
      credentialLabel: "River API key",
      capabilityNote:
        "River exposes no documented balance API; add credit and allowance snapshots manually.",
      capabilities: CAPABILITIES,
      ctx,
    });
  }
}

export const capabilities = CAPABILITIES;
