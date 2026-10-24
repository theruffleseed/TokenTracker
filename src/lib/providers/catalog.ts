import type { ProviderCapabilities } from "./types";
import type { ProviderKey } from "../schemas";

export interface ProviderCatalogEntry {
  key: ProviderKey;
  slug: string;
  name: string;
  vendor: string;
  blurb: string;
  authLabel: string;
  docsUrl: string;
  capabilityNotes: string[];
  capabilities: ProviderCapabilities;
}

export const PROVIDER_CATALOG: Record<ProviderKey, ProviderCatalogEntry> = {
  OPENCODE_GO: {
    key: "OPENCODE_GO",
    slug: "opencode-go",
    name: "OpenCode Go",
    vendor: "OpenCode",
    blurb: "Monthly Go / Go Plus subscription with 5-hour, weekly, and monthly meters.",
    authLabel: "Go API key (oc_sk_…)",
    docsUrl: "https://opencode.ai/docs/go/",
    capabilityNotes: [
      "Reads the usage meters shown in the OpenCode console.",
      "The usage route is community-verified but not in OpenCode's public API docs.",
      "Zen pay-as-you-go balance is not exposed by an API-key endpoint.",
    ],
    capabilities: {
      quotaWindows: ["rolling_5h", "weekly", "monthly"],
      creditBalance: false,
      usageHistory: false,
      modelScopes: false,
      connectionProbe: true,
      experimental: true,
    },
  },
  TOKENHARBOR: {
    key: "TOKENHARBOR",
    slug: "tokenharbor",
    name: "TokenHarbor",
    vendor: "Token Harbor",
    blurb: "Prepaid USD wallet plus optional four-week Pass allowance.",
    authLabel: "Universal key (thk_live_…)",
    docsUrl: "https://tokenharbor.ai/docs",
    capabilityNotes: [
      "The Universal Key can validate access and list models.",
      "No documented API exposes wallet balance or Pass allowance usage.",
      "Track balance and Pass windows with manual snapshots.",
    ],
    capabilities: {
      quotaWindows: [],
      creditBalance: false,
      usageHistory: false,
      modelScopes: false,
      connectionProbe: true,
      experimental: false,
    },
  },
  RIVER_AI: {
    key: "RIVER_AI",
    slug: "river-ai",
    name: "River AI",
    vendor: "River",
    blurb: "Pay-as-you-go inference balance; usage is shown in the River Console.",
    authLabel: "River API key (rv_…)",
    docsUrl: "https://docs.river.ai/guides/inference/",
    capabilityNotes: [
      "The API key validates against the documented models endpoint.",
      "River documents a 402 for insufficient balance but no balance API.",
      "Track credit and any plan allowance with manual snapshots.",
    ],
    capabilities: {
      quotaWindows: [],
      creditBalance: false,
      usageHistory: false,
      modelScopes: false,
      connectionProbe: true,
      experimental: false,
    },
  },
  COMMANDCODE: {
    key: "COMMANDCODE",
    slug: "commandcode",
    name: "Command Code",
    vendor: "Command Code",
    blurb: "Subscription credits with rolling 5-hour, weekly, and monthly limits.",
    authLabel: "Command Code API key",
    docsUrl: "https://commandcode.ai/docs/resources/pricing-limits",
    capabilityNotes: [
      "Reads the same credit and rolling-window meters as the CLI's /usage.",
      "The billing routes are alpha endpoints used by the CLI, not the public Provider API.",
      "Per-model usage breakdown is not available from the billing summary.",
    ],
    capabilities: {
      quotaWindows: ["rolling_5h", "weekly", "monthly"],
      creditBalance: true,
      usageHistory: false,
      modelScopes: false,
      connectionProbe: true,
      experimental: true,
    },
  },
};

export const PROVIDER_LIST = Object.values(PROVIDER_CATALOG);

export function providerBySlug(slug: string): ProviderCatalogEntry | null {
  return PROVIDER_LIST.find((entry) => entry.slug === slug) ?? null;
}

export function providerName(key: ProviderKey): string {
  return PROVIDER_CATALOG[key]?.name ?? key;
}
