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

export class TokenHarborAdapter extends ProbeOnlyAdapter {
  constructor(ctx: AdapterContext) {
    super({
      providerId: "TOKENHARBOR",
      baseUrl: ctx.baseUrl ?? "https://tokenharbor.ai",
      modelsPath: "/v1/models",
      credentialLabel: "TokenHarbor Universal Key",
      capabilityNote:
        "TokenHarbor has no documented balance/quota API; add wallet and Pass snapshots manually.",
      capabilities: CAPABILITIES,
      ctx,
    });
  }
}

export const capabilities = CAPABILITIES;
