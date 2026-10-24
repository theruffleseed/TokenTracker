import { describe, expect, it } from "vitest";
import {
  computeFreshness,
  formatCountdown,
  formatMetric,
  formatRelative,
  lowestRemainingPercent,
  remainingBand,
  usageBand,
  usagePercentFromQuota,
} from "@/lib/quota";

const NOW = new Date("2026-10-24T12:00:00.000Z");

describe("quota presentation helpers", () => {
  it("never fabricates a percent for unknown values", () => {
    expect(formatMetric(null, "usd")).toBe("Not available");
    expect(remainingBand(null)).toBe("unknown");
  });

  it("distinguishes units without converting between them", () => {
    expect(formatMetric(12.5, "usd")).toContain("$12.50");
    expect(formatMetric(1200, "tokens")).toContain("1,200 tokens");
    expect(formatMetric(82, "percent")).toBe("82%");
    expect(formatMetric(9, "credits")).toContain("9 credits");
  });

  it("formats countdowns from days down to seconds", () => {
    expect(formatCountdown(new Date(NOW.getTime() + 2 * 86_400_000 + 4 * 3_600_000), NOW)).toBe("2d 4h");
    expect(formatCountdown(new Date(NOW.getTime() + 3 * 3_600_000 + 12 * 60_000), NOW)).toBe("3h 12m");
    expect(formatCountdown(new Date(NOW.getTime() + 4 * 60_000 + 9_000), NOW)).toBe("4m 09s");
    expect(formatCountdown(null, NOW)).toBe("Reset time unavailable");
    expect(formatCountdown(new Date(NOW.getTime() - 1), NOW)).toBe("Reset due");
  });

  it("describes relative times without inventing freshness", () => {
    expect(formatRelative(new Date(NOW.getTime() - 18 * 60_000), NOW)).toBe("18 min ago");
  });

  it("marks stale live data after two intervals", () => {
    const fresh = computeFreshness({
      lastLiveSyncAt: new Date(NOW.getTime() - 10 * 60_000),
      latestObservationAt: new Date(NOW.getTime() - 10 * 60_000),
      latestSource: "live",
      refreshIntervalMin: 30,
      hasError: false,
      now: NOW,
    });
    expect(fresh.kind).toBe("live");

    const stale = computeFreshness({
      lastLiveSyncAt: new Date(NOW.getTime() - 3 * 3_600_000),
      latestObservationAt: new Date(NOW.getTime() - 3 * 3_600_000),
      latestSource: "live",
      refreshIntervalMin: 30,
      hasError: false,
      now: NOW,
    });
    expect(stale.kind).toBe("stale");
    expect(stale.label).toContain("Stale");
  });

  it("does not call an empty live connection fresh data", () => {
    const connected = computeFreshness({
      lastLiveSyncAt: new Date(NOW.getTime() - 60_000),
      latestObservationAt: null,
      latestSource: null,
      refreshIntervalMin: 30,
      hasError: false,
      now: NOW,
    });
    expect(connected.kind).toBe("live");
    expect(connected.label).toContain("no metrics");
  });

  it("labels manual data as manual rather than live", () => {
    const manual = computeFreshness({
      lastLiveSyncAt: null,
      latestObservationAt: new Date(NOW.getTime() - 5 * 60_000),
      latestSource: "manual",
      refreshIntervalMin: 30,
      hasError: false,
      now: NOW,
    });
    expect(manual.kind).toBe("manual");
    expect(manual.label).toContain("Manual");
  });

  it("derives a consumption percentage for the progress bar", () => {
    expect(
      usagePercentFromQuota({ remainingPercent: 84, used: null, limit: 100 }),
    ).toBe(16);
    expect(
      usagePercentFromQuota({ remainingPercent: null, used: 15, limit: 20 }),
    ).toBe(75);
    expect(
      usagePercentFromQuota({ remainingPercent: null, used: null, limit: 20 }),
    ).toBeNull();
    expect(
      usagePercentFromQuota({ remainingPercent: null, used: 0, limit: 0 }),
    ).toBeNull();
  });

  it("uses progressive consumption bands with black at the limit", () => {
    expect(usageBand(0)).toBe("safe");
    expect(usageBand(49.9)).toBe("safe");
    expect(usageBand(50)).toBe("watch");
    expect(usageBand(65)).toBe("elevated");
    expect(usageBand(80)).toBe("critical");
    expect(usageBand(99.4)).toBe("critical");
    expect(usageBand(100)).toBe("full");
    expect(usageBand(null)).toBe("unknown");
  });

  it("selects the lowest supported window and ignores null percents", () => {
    const lowest = lowestRemainingPercent([
      { window: "monthly", remainingPercent: 80, modelScope: null },
      { window: "rolling_5h", remainingPercent: 4, modelScope: null },
      { window: "weekly", remainingPercent: null, modelScope: null },
      { window: "weekly", remainingPercent: 12, modelScope: "model-a" },
    ]);

    expect(lowest).toEqual({ percent: 4, window: "rolling_5h", modelScope: null });
    expect(lowestRemainingPercent([{ window: "monthly", remainingPercent: null, modelScope: null }])).toBeNull();
  });
});
