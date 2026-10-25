import Image from "next/image";
import type { ProviderKey } from "@/lib/schemas";

const PROVIDER_LOGOS: Record<ProviderKey, { src: string; inset: string }> = {
  OPENCODE_GO: { src: "/providers/opencode.svg", inset: "" },
  TOKENHARBOR: { src: "/providers/tokenharbor.svg", inset: "p-[3px]" },
  RIVER_AI: { src: "/providers/river.png", inset: "" },
  COMMANDCODE: { src: "/providers/commandcode.png", inset: "" },
  QODER: { src: "/providers/qoder.png", inset: "" },
  YETA: { src: "/providers/yeta.svg", inset: "" },
};

export function ProviderLogo({
  provider,
  label,
  className = "h-8 w-8",
}: {
  provider: ProviderKey;
  label: string;
  className?: string;
}) {
  const logo = PROVIDER_LOGOS[provider];

  return (
    <span
      title={label}
      className={`relative inline-flex shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-900/10 ${className}`}
    >
      <Image
        src={logo.src}
        alt=""
        fill
        sizes="32px"
        unoptimized
        className={`${logo.inset} ${logo.inset ? "object-contain" : "object-cover"}`}
      />
    </span>
  );
}
