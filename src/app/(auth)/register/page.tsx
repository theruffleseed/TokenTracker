import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        One private dashboard for every AI quota.
      </p>
      <div className="mt-7 card p-5 sm:p-6">
        <AuthForm mode="register" />
      </div>
    </main>
  );
}
