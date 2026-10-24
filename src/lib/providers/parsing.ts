import type { JsonResponse } from "./http";
import { AdapterError } from "./types";

export type JsonMap = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function atPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Finds the first numeric value at any of the dot-separated paths. */
export function numberAt(root: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = atPath(root, path.split("."));
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function stringAt(root: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = atPath(root, path.split("."));
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Accepts ISO timestamps, Unix epoch milliseconds, Unix epoch seconds, or a
 * relative number of seconds. Returns an ISO string in UTC.
 */
export function dateAt(
  root: unknown,
  paths: string[],
  options: { relativeSeconds?: boolean; now?: Date } = {},
): string | null {
  for (const path of paths) {
    const value = atPath(root, path.split("."));
    if (value === null || value === undefined) continue;

    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const fromNumber = epochToIso(numeric);
        if (fromNumber) return fromNumber;
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      if (options.relativeSeconds) {
        return new Date((options.now ?? new Date()).getTime() + value * 1000).toISOString();
      }
      const fromNumber = epochToIso(value);
      if (fromNumber) return fromNumber;
    }
  }
  return null;
}

function epochToIso(value: number): string | null {
  let ms: number;
  if (value > 1_000_000_000_000) ms = value;
  else if (value > 1_000_000_000) ms = value * 1000;
  else return null;

  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function clampPercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, round(value, 4)));
}

export function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Derives remaining amounts only when enough source values exist. */
export function deriveQuota(input: {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
}): {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  remainingPercent: number | null;
} {
  const { limit } = input;
  let { used, remaining, remainingPercent } = input;

  if (remaining === null && limit !== null && used !== null) {
    remaining = round(Math.max(0, limit - used));
  }
  if (used === null && limit !== null && remaining !== null) {
    used = round(Math.max(0, limit - remaining));
  }
  if (remainingPercent === null && remaining !== null && limit !== null && limit > 0) {
    remainingPercent = clampPercent((remaining / limit) * 100);
  }
  if (remaining === null && remainingPercent !== null && limit !== null) {
    remaining = round((remainingPercent / 100) * limit);
  }
  if (remaining === null && used === null && remainingPercent !== null) {
    remainingPercent = clampPercent(remainingPercent);
  }

  return {
    limit,
    used,
    remaining,
    remainingPercent: clampPercent(remainingPercent),
  };
}

export function assertJsonResponse(response: JsonResponse): unknown {
  if (response.data === null) {
    throw new AdapterError("MALFORMED_RESPONSE", "The provider returned an empty response", {
      httpStatus: response.status,
    });
  }
  return response.data;
}

export function normalizeCurrency(value: string | null): string {
  const upper = (value ?? "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : "USD";
}
