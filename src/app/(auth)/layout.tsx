import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Brand } from "@/components/Brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
        <div className="mb-8">
          <Brand />
        </div>
        {children}
        <p className="mt-8 text-center text-xs leading-relaxed text-slate-400">
          Quota data stays on your server. Provider keys are encrypted at rest
          and never sent to the browser.
        </p>
      </div>
    </div>
  );
}
