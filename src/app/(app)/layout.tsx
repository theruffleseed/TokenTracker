import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppNav } from "@/components/AppNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      <AppNav email={user.email} displayName={user.displayName} />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
