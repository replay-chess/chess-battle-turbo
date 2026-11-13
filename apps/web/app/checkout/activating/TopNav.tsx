// The marketing top bar of the activating page (board DR/V3CheckoutActivating `.tn`: 64 px, 48 px at ≤ 640 px tall;
// links hidden on phones). Static markup (no client JS) until P11's MarketingTopNav replaces it. Also used by the
// /dev/ui/activating demo.
import Image from "next/image";
import Link from "next/link";

const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/#how", label: "Coaching" },
  { href: "/legends", label: "Learn" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "");
  return letters.toUpperCase() || "·";
}

export function ActivatingTopNav({ name, profileHref }: { name: string; profileHref: string }) {
  return (
    <header className="flex h-16 flex-none items-center gap-7 border-b border-cb-border bg-cb-bg/85 px-8 max-[1100px]:gap-[18px] max-[1100px]:px-5 max-[600px]:px-4 [@media(max-height:640px)]:h-12">
      <Link href="/" aria-label="ReplayChess home" className="flex min-h-11 items-center gap-2.5 text-cb-text no-underline">
        <Image src="/chess-logo-bnw.png" alt="" width={36} height={36} className="size-9 dark:invert [@media(max-height:640px)]:size-7" />
        <span className="font-serif text-[1.375rem] leading-none">ReplayChess</span>
      </Link>
      <nav aria-label="Main" className="flex gap-[22px] max-[1100px]:gap-3.5 max-[700px]:hidden">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center justify-center font-mono text-xs font-medium uppercase tracking-[0.12em] text-cb-text-soft no-underline hover:text-cb-text pointer-coarse:min-w-11">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2.5">
        <Link href="/play" className="inline-flex min-h-9 items-center bg-cb-accent px-4.5 text-sm font-medium text-cb-accent-fg no-underline hover:bg-cb-accent-hover pointer-coarse:min-h-11">
          Play
        </Link>
        {/* The name starts with the visible initials (WCAG 2.5.3 label in name) and the initials use the soft text
            colour, which meets 4.5:1 on the fill in both themes (regression: activating-avatar-a11y,
            e2e/devices/ui/onboarding.a11y.spec.ts). */}
        {/* Touch screens get a 44 px target around the 32 px avatar of the board (FIX-1, WCAG 2.5.5). */}
        <Link
          href={profileHref}
          aria-label={`${initialsOf(name)}, your profile`}
          className="inline-flex size-8 items-center justify-center no-underline pointer-coarse:size-11"
        >
          <span className="inline-flex size-8 items-center justify-center rounded-full border border-cb-border-strong bg-cb-fill font-mono text-label text-cb-text-soft">
            {initialsOf(name)}
          </span>
        </Link>
      </div>
    </header>
  );
}
