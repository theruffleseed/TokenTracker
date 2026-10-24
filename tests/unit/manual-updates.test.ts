import { describe, expect, it } from "vitest";
import {
  MANUAL_UPDATE_INTERVAL_DAYS,
  manualUpdateState,
} from "@/lib/manual-updates";

const NOW = new Date("2026-10-24T12:00:00.000Z").getTime();

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("manualUpdateState", () => {
  it("flags a missing observation as due", () => {
    expect(manualUpdateState(null, NOW)).toEqual({
      ageDays: null,
      due: true,
      label: "No data yet",
    });
  });

  it("treats an observation from today as current", () => {
    expect(manualUpdateState(daysAgo(0), NOW)).toEqual({
      ageDays: 0,
      due: false,
      label: "Updated today",
    });
  });

  it("counts whole days since the observation", () => {
    expect(manualUpdateState(daysAgo(3), NOW)).toEqual({
      ageDays: 3,
      due: false,
      label: "Updated 3d ago",
    });
  });

  it("flags an observation at the weekly interval as due", () => {
    const state = manualUpdateState(daysAgo(MANUAL_UPDATE_INTERVAL_DAYS), NOW);

    expect(state.due).toBe(true);
    expect(state.ageDays).toBe(MANUAL_UPDATE_INTERVAL_DAYS);
  });

  it("treats an unparseable timestamp as due", () => {
    expect(manualUpdateState("not-a-date", NOW)).toEqual({
      ageDays: null,
      due: true,
      label: "No data yet",
    });
  });

  it("does not produce a negative age for a future timestamp", () => {
    const nextWeek = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();

    expect(manualUpdateState(nextWeek, NOW)).toEqual({
      ageDays: 0,
      due: false,
      label: "Updated today",
    });
  });
});
