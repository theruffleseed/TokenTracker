const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Both probe-only providers operate on weekly windows, so a manual snapshot
 * older than a week is worth flagging for an update.
 */
export const MANUAL_UPDATE_INTERVAL_DAYS = 7;

export interface ManualUpdateState {
  ageDays: number | null;
  due: boolean;
  label: string;
}

export function manualUpdateState(
  latestObservationAt: string | null,
  now: number = Date.now(),
): ManualUpdateState {
  if (!latestObservationAt) {
    return { ageDays: null, due: true, label: "No data yet" };
  }

  const observed = new Date(latestObservationAt).getTime();
  if (!Number.isFinite(observed)) {
    return { ageDays: null, due: true, label: "No data yet" };
  }

  const ageDays = Math.max(0, Math.floor((now - observed) / DAY_MS));
  return {
    ageDays,
    due: ageDays >= MANUAL_UPDATE_INTERVAL_DAYS,
    label: ageDays === 0 ? "Updated today" : `Updated ${ageDays}d ago`,
  };
}
