"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface SettingsValues {
  email: string;
  displayName: string | null;
  timezone: string;
  refreshIntervalMin: number;
  quotaRetentionDays: number;
  usageRetentionDays: number;
  auditRetentionDays: number;
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [values, setValues] = useState({
    displayName: initial.displayName ?? "",
    timezone: initial.timezone,
    refreshIntervalMin: String(initial.refreshIntervalMin),
    quotaRetentionDays: String(initial.quotaRetentionDays),
    usageRetentionDays: String(initial.usageRetentionDays),
    auditRetentionDays: String(initial.auditRetentionDays),
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [
        "UTC",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Kuala_Lumpur",
        "Asia/Singapore",
        "Asia/Tokyo",
        "Australia/Sydney",
      ];
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName.trim() || null,
          timezone: values.timezone,
          refreshIntervalMin: Number(values.refreshIntervalMin),
          quotaRetentionDays: Number(values.quotaRetentionDays),
          usageRetentionDays: Number(values.usageRetentionDays),
          auditRetentionDays: Number(values.auditRetentionDays),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: Array<{ message: string }> } }
        | null;
      if (!response.ok) {
        setError(body?.error?.details?.[0]?.message ?? body?.error?.message ?? "Could not save settings");
        return;
      }
      setMessage("Settings saved");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Profile & display</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-email" className="label mb-1.5">
              Email
            </label>
            <input id="p-email" className="input bg-slate-50 text-slate-500" value={initial.email} disabled />
          </div>
          <div>
            <label htmlFor="p-name" className="label mb-1.5">
              Display name
            </label>
            <input
              id="p-name"
              className="input"
              maxLength={80}
              value={values.displayName}
              onChange={(event) => setValues((current) => ({ ...current, displayName: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="p-timezone" className="label mb-1.5">
              Timezone
            </label>
            <input
              id="p-timezone"
              className="input"
              list="timezone-options"
              value={values.timezone}
              onChange={(event) => setValues((current) => ({ ...current, timezone: event.target.value }))}
            />
            <datalist id="timezone-options">
              {timezones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-slate-400">Used for reset timestamps and history.</p>
          </div>
          <div>
            <label htmlFor="p-interval" className="label mb-1.5">
              Default refresh interval
            </label>
            <select
              id="p-interval"
              className="input"
              value={values.refreshIntervalMin}
              onChange={(event) => setValues((current) => ({ ...current, refreshIntervalMin: event.target.value }))}
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="180">3 hours</option>
              <option value="720">12 hours</option>
              <option value="1440">24 hours</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-400">Applied to newly connected providers.</p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Data retention</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Retention runs in the background worker every six hours. Shorter windows reduce stored
          observations but do not change the provider&apos;s own data.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["quotaRetentionDays", "Quota & credit snapshots", "days"],
              ["usageRetentionDays", "Usage records", "days"],
              ["auditRetentionDays", "Audit events", "days"],
            ] as const
          ).map(([key, label, suffix]) => (
            <div key={key}>
              <label htmlFor={`r-${key}`} className="label mb-1.5">
                {label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`r-${key}`}
                  type="number"
                  min={7}
                  max={3650}
                  className="input"
                  value={values[key as keyof typeof values]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
                <span className="text-xs text-slate-400">{suffix}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [revoke, setRevoke] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/settings/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: revoke,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: Array<{ message: string }> } }
        | null;
      if (!response.ok) {
        setError(body?.error?.details?.[0]?.message ?? body?.error?.message ?? "Could not change password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="pw-current" className="label mb-1.5">
          Current password
        </label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="pw-new" className="label mb-1.5">
          New password
        </label>
        <input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="input"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={revoke}
          onChange={(event) => setRevoke(event.target.checked)}
          className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
        />
        Sign out every other session
      </label>

      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
      {message ? <p role="status" className="text-xs text-emerald-600">{message}</p> : null}

      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
