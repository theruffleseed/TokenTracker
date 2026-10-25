"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./icons";

const NAV: Array<{ href: string; label: string; icon: IconName; exact?: boolean }> = [
  { href: "/dashboard", label: "Overview", icon: "dashboard", exact: true },
  { href: "/providers/new", label: "Add provider", icon: "plus" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({
  email,
  displayName,
}: {
  email: string;
  displayName: string | null;
}) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <>
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-slate-200 bg-white/80 px-3 py-5 backdrop-blur lg:flex">
        <div className="px-2">
          <Brand />
        </div>

        <nav className="mt-8 space-y-1" aria-label="Main">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 border-t border-slate-200 pt-4">
          <div className="px-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {displayName || email.split("@")[0]}
            </p>
            <p className="truncate text-xs text-slate-500">{email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <Icon name="logout" className="h-4 w-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-canvas/90 px-4 pb-3 backdrop-blur lg:hidden"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2.25rem)" }}
      >
        <Brand />
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          aria-label="Sign out"
        >
          <Icon name="logout" className="h-5 w-5" />
        </button>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Main"
      >
        {NAV.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active ? "text-slate-900" : "text-slate-500"
              }`}
            >
              <Icon name={item.icon} className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
