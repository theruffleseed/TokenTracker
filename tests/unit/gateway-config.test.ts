import { describe, expect, it } from "vitest";
import {
  gatewayEndpointFor,
  gatewayUpstreamFor,
  weeklyAllowanceForPlan,
} from "@/lib/gateway/config";
import {
  createGatewayToken,
  gatewayTokenFromHeaders,
  hashGatewayToken,
  looksLikeGatewayToken,
} from "@/lib/gateway/tokens";

describe("gateway routing", () => {
  it("allows only compatible inference paths", () => {
    expect(gatewayEndpointFor(["v1", "chat", "completions"], "POST")).toBe("openai_chat");
    expect(gatewayEndpointFor(["v1", "messages"], "POST")).toBe("anthropic_messages");
    expect(gatewayEndpointFor(["v1", "responses"], "POST")).toBe("openai_responses");
    expect(gatewayEndpointFor(["v1", "models"], "GET")).toBe("passthrough");
    expect(gatewayEndpointFor(["v1", "messages", "count_tokens"], "POST")).toBe("passthrough");
    expect(gatewayEndpointFor(["v1", "embeddings"], "POST")).toBeNull();
    expect(gatewayEndpointFor(["admin"], "POST")).toBeNull();
    expect(gatewayEndpointFor(["v1", "models"], "POST")).toBeNull();
  });

  it("maps only TokenHarbor and River to upstreams", () => {
    expect(gatewayUpstreamFor("TOKENHARBOR")?.baseUrl).toBe("https://tokenharbor.ai");
    expect(gatewayUpstreamFor("RIVER_AI")?.baseUrl).toBe("https://api.river.ai");
    expect(gatewayUpstreamFor("OPENCODE_GO")).toBeNull();
    expect(gatewayUpstreamFor("COMMANDCODE")).toBeNull();
  });
});

describe("Pass allowance", () => {
  it("maps published four-week values to weekly windows", () => {
    expect(weeklyAllowanceForPlan("Office Pass")).toBe(8.75);
    expect(weeklyAllowanceForPlan("agent")).toBe(2.5);
    expect(weeklyAllowanceForPlan("Frontier")).toBe(45);
    expect(weeklyAllowanceForPlan("Custom")).toBeNull();
    expect(weeklyAllowanceForPlan(null)).toBeNull();
  });
});

describe("gateway token", () => {
  it("issues a prefixed token, stores only a hash, and shows a short hint", () => {
    const issued = createGatewayToken();
    expect(issued.token.startsWith("ttg_")).toBe(true);
    expect(issued.token.length).toBeGreaterThan(40);
    expect(issued.hint).toContain("…");
    expect(issued.hint.length).toBeLessThanOrEqual(32);
    expect(issued.tokenHash).toBe(hashGatewayToken(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(looksLikeGatewayToken(issued.token)).toBe(true);
    expect(looksLikeGatewayToken("sk-provider-key")).toBe(false);
  });

  it("accepts Bearer and x-api-key clients", () => {
    expect(gatewayTokenFromHeaders(new Headers({ Authorization: "Bearer ttg_abc" }))).toBe("ttg_abc");
    expect(gatewayTokenFromHeaders(new Headers({ "x-api-key": "ttg_xyz" }))).toBe("ttg_xyz");
    expect(gatewayTokenFromHeaders(new Headers())).toBeNull();
  });
});
