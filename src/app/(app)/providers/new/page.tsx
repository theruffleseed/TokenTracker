import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { AddProviderForm } from "@/components/AddProviderForm";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Add provider" };
export const dynamic = "force-dynamic";

export default async function NewProviderPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const env = getEnv();

  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
          <Icon name="chevron-left" className="h-3.5 w-3.5" />
          Back to overview
        </Link>
      </div>
      <PageHeader
        eyebrow="Connections"
        title="Add a provider"
        description="Choose what to track. Providers without a documented quota API can still be tracked with manual snapshots."
      />
      <AddProviderForm experimentalEnabled={env.ENABLE_EXPERIMENTAL_ADAPTERS} />
    </>
  );
}
