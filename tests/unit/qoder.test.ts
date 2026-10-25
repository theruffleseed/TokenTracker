import { describe, expect, it } from "vitest";
import { QoderAdapter, type QoderUsage } from "@/lib/providers/qoder";
import { AdapterError } from "@/lib/providers/types";

const NOW = new Date("2026-10-25T09:00:00.000Z");

const FREE: QoderUsage = {
  plan: "Free",
  planCredits: { used: 0, total: 0 },
  addOnCredits: null,
  expiresAt: null,
};

const PRO: QoderUsage = {
  plan: "Pro",
  planCredits: { used: 750, total: 2000 },
  addOnCredits: { used: 100, total: 1500 },
  expiresAt: "2026-11-13T00:00:00.000Z",
};

function adapter(usage: QoderUsage, planName: string | null = null) {
  return new QoderAdapter(
    {
      credential: null,
      accountLabel: "Work",
      planName,
      now: () => NOW,
      timeoutMs: 1_000,
    },
    async () => usage,
  );
}

describe("Qoder CLI adapter", () => {
  it("reports a Free plan as connected with no fabricated credits", async () => {
    const account = await adapter(FREE).validateConnection();
    expect(account.ok).toBe(true);
    if (account.ok) {
      expect(account.data.planName).toBe("Free");
      expect(account.data.planDetails).toBe("Free plan · no plan credits");
      expect(account.data.status).toBe("CONNECTED");
    }

    const quota = await adapter(FREE).getQuotaSnapshots();
    expect(quota.ok).toBe(true);
    if (quota.ok) expect(quota.data).toEqual([]);
  });

  it("maps plan and add-on credits to monthly rows", async () => {
    const result = await adapter(PRO).getQuotaSnapshots();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);
    const plan = result.data.find((row) => row.modelScope === null);
    expect(plan).toMatchObject({
      window: "monthly",
      unit: "credits",
      limit: 2000,
      used: 750,
      remaining: 1250,
      remainingPercent: 62.5,
      resetsAt: "2026-11-13T00:00:00.000Z",
      source: "live",
    });

    const addOn = result.data.find((row) => row.modelScope === "Add-on credits");
    expect(addOn).toMatchObject({
      window: "monthly",
      unit: "credits",
      limit: 1500,
      used: 100,
      remaining: 1400,
      resetsAt: null,
      source: "live",
    });
  });

  it("lets a saved plan name override the CLI tier", async () => {
    const account = await adapter(PRO, "Work Pro").validateConnection();
    expect(account.ok).toBe(true);
    if (account.ok) expect(account.data.planName).toBe("Work Pro");
  });

  it("surfaces a missing CLI login as not configured", async () => {
    const failing = new QoderAdapter(
      {
        credential: null,
        accountLabel: null,
        planName: null,
        now: () => NOW,
      },
      async () => {
        throw new AdapterError(
          "NOT_CONFIGURED",
          "Qoder CLI is not signed in; run 'qodercli login' on this machine",
        );
      },
    );

    const result = await failing.getQuotaSnapshots();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_CONFIGURED");
  });

  it("keeps the connection when only an add-on pack exists", async () => {
    const usage: QoderUsage = {
      plan: "Pro",
      planCredits: { used: 0, total: 0 },
      addOnCredits: { used: 50, total: 500 },
      expiresAt: null,
    };

    const result = await adapter(usage).getQuotaSnapshots();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.modelScope).toBe("Add-on credits");
      expect(result.data[0]?.remaining).toBe(450);
    }
  });
});
