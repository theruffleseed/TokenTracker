import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        The page you are looking for does not exist, or the provider connection was removed.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        Back to overview
      </Link>
    </main>
  );
}
