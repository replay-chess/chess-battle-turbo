"use client";

import Image from "next/image";
import Link from "next/link";
import { useFlag } from "@/lib/flags/client";
import { brandHref } from "@/lib/nav/destinations";
import { cn } from "@/lib/utils";

/**
 * Logo plus wordmark. Without an `href` it links to the shell's home: /home once the viewer's `home` flag is on (P5
 * plan §4.8, "logo → /home"), /play before that (Phase 1).
 */
export function Brand({
  href,
  logoClassName,
  wordmarkClassName,
  className,
  onNavigate,
}: {
  href?: string;
  /** Sizes the square logo (default 32px). */
  logoClassName?: string;
  wordmarkClassName?: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const home = useFlag("home");
  return (
    <Link
      href={href ?? brandHref({ home })}
      data-testid="shell-brand"
      onClick={onNavigate}
      className={cn(
        "flex min-h-11 min-w-11 items-center gap-2.5 text-cb-text [-webkit-tap-highlight-color:transparent] focus-visible:-outline-offset-2",
        className,
      )}
    >
      <Image
        src="/chess-logo-bnw.png"
        alt="ReplayChess home"
        width={32}
        height={32}
        priority
        className={cn("size-8 shrink-0", logoClassName)}
      />
      <span aria-hidden="true" className={cn("font-serif text-wordmark", wordmarkClassName)}>
        ReplayChess
      </span>
    </Link>
  );
}
