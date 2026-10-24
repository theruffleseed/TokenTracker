import type { AdapterContext, ProviderAdapter } from "./types";
import { AdapterError } from "./types";
import { OpenCodeGoAdapter } from "./opencode-go";
import { CommandCodeAdapter } from "./commandcode";
import { TokenHarborAdapter } from "./tokenharbor";
import { RiverAiAdapter } from "./river-ai";
import { PROVIDER_CATALOG } from "./catalog";
import type { ProviderKey } from "../schemas";
import { getEnv } from "../env";

export function createAdapter(provider: ProviderKey, ctx: AdapterContext): ProviderAdapter {
  const catalog = PROVIDER_CATALOG[provider];

  if (catalog.capabilities.experimental && !getEnv().ENABLE_EXPERIMENTAL_ADAPTERS) {
    throw new AdapterError(
      "UNSUPPORTED",
      `${catalog.name} live quota uses a community-observed route. Enable ENABLE_EXPERIMENTAL_ADAPTERS after reviewing the capability matrix, or use manual snapshots.`,
    );
  }

  switch (provider) {
    case "OPENCODE_GO":
      return new OpenCodeGoAdapter(ctx);
    case "COMMANDCODE":
      return new CommandCodeAdapter(ctx);
    case "TOKENHARBOR":
      return new TokenHarborAdapter(ctx);
    case "RIVER_AI":
      return new RiverAiAdapter(ctx);
    default: {
      const exhaustive: never = provider;
      throw new AdapterError("UNSUPPORTED", `Unknown provider ${String(exhaustive)}`);
    }
  }
}

export function supportsUsageHistory(provider: ProviderKey): boolean {
  return PROVIDER_CATALOG[provider].capabilities.usageHistory;
}
