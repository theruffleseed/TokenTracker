import type { ProviderKey } from "../schemas";

export interface GatewayUpstream {
  provider: "TOKENHARBOR" | "RIVER_AI";
  baseUrl: string;
  label: string;
}

const UPSTREAMS: Partial<Record<ProviderKey, GatewayUpstream>> = {
  TOKENHARBOR: {
    provider: "TOKENHARBOR",
    baseUrl: "https://tokenharbor.ai",
    label: "TokenHarbor",
  },
  RIVER_AI: {
    provider: "RIVER_AI",
    baseUrl: "https://api.river.ai",
    label: "River",
  },
};

export function gatewayUpstreamFor(provider: ProviderKey): GatewayUpstream | null {
  return UPSTREAMS[provider] ?? null;
}

export type GatewayEndpoint =
  | "openai_chat"
  | "anthropic_messages"
  | "openai_responses"
  | "passthrough";

/** Resolve an allowed endpoint, or null when the path is not proxied. */
export function gatewayEndpointFor(
  path: string[],
  method: "GET" | "POST",
): GatewayEndpoint | null {
  const joined = path.join("/").replace(/\/+$/, "");
  if (method === "POST") {
    if (joined === "v1/chat/completions") return "openai_chat";
    if (joined === "v1/messages") return "anthropic_messages";
    if (joined === "v1/responses") return "openai_responses";
    if (joined === "v1/messages/count_tokens") return "passthrough";
    return null;
  }
  if (method === "GET" && joined === "v1/models") return "passthrough";
  return null;
}

export function isMeteredEndpoint(endpoint: GatewayEndpoint): boolean {
  return endpoint !== "passthrough";
}

/**
 * TokenHarbor Passes are sold as four-week value blocks divided into four
 * seven-day windows. These are the published values, not vendor-reported
 * account data.
 */
export const PASS_WEEKLY_ALLOWANCE_USD = {
  agent: 2.5,
  office: 8.75,
  frontier: 45,
} as const;

export function weeklyAllowanceForPlan(planName: string | null): number | null {
  if (!planName) return null;
  const normalized = planName.toLowerCase();
  for (const [plan, amount] of Object.entries(PASS_WEEKLY_ALLOWANCE_USD)) {
    if (normalized.includes(plan)) return amount;
  }
  return null;
}

export function passLabelForPlan(planName: string | null): string | null {
  if (!planName) return null;
  const normalized = planName.toLowerCase();
  for (const plan of Object.keys(PASS_WEEKLY_ALLOWANCE_USD)) {
    if (normalized.includes(plan)) {
      return plan.charAt(0).toUpperCase() + plan.slice(1);
    }
  }
  return null;
}
