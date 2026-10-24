import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listAccounts } from "@/lib/dashboard";
import { DashboardView } from "@/components/DashboardView";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accounts = await listAccounts(user.id);

  return <DashboardView accounts={accounts} />;
}
