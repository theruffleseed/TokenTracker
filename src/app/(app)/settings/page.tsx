import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SettingsForm, PasswordForm } from "@/components/SettingsForms";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const settings = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      email: true,
      displayName: true,
      timezone: true,
      refreshIntervalMin: true,
      quotaRetentionDays: true,
      usageRetentionDays: true,
      auditRetentionDays: true,
      createdAt: true,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Display, refresh cadence, retention, exports, and account security."
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <SettingsForm
          initial={{
            email: settings.email,
            displayName: settings.displayName,
            timezone: settings.timezone,
            refreshIntervalMin: settings.refreshIntervalMin,
            quotaRetentionDays: settings.quotaRetentionDays,
            usageRetentionDays: settings.usageRetentionDays,
            auditRetentionDays: settings.auditRetentionDays,
          }}
        />

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Export</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Download every provider, quota observation, and balance snapshot. Credentials and
              session tokens are never included.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <a href="/api/export?format=json" download className="btn-secondary w-full">
                <Icon name="download" className="h-4 w-4" />
                Download JSON
              </a>
              <a href="/api/export?format=csv" download className="btn-secondary w-full">
                <Icon name="download" className="h-4 w-4" />
                Download usage CSV
              </a>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Security</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Passwords are hashed with scrypt. Sessions are HttpOnly cookies and only a hash of each
              session token is stored. Provider keys use AES-256-GCM at rest.
            </p>
            <PasswordForm />
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Data sources</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              The provider capability matrix records exactly which metrics are verified, which routes
              are experimental, and which providers require manual entry.
            </p>
            <Link
              href="https://github.com/theruffleseed/TokenTracker/blob/main/docs/provider-capability-matrix.md"
              target="_blank"
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 underline underline-offset-2"
            >
              Read the capability matrix
              <Icon name="external" className="h-3.5 w-3.5" />
            </Link>
            <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
              Member since {settings.createdAt.toISOString().slice(0, 10)}.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
