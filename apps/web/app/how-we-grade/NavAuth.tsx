"use client";

// The marketing nav's right side (plan §4.5): signed out → Sign In + Start Free Trial; signed in → Play + the
// avatar. Clerk's useAuth()/useUser() read the session Clerk already loaded, so this makes no request of its own.
// The box keeps one fixed size in every state (and while Clerk loads, when it is empty), so nothing shifts.
import Link from "next/link";
import { useAuth, useUser } from "@clerk/nextjs";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BOX = "ml-auto flex h-11 w-[236px] shrink-0 items-center justify-end gap-2.5 [@media(max-width:600px)]:w-auto";
const SMALL = "min-h-9 pointer-coarse:min-h-11";

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

export function NavAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return <div className={BOX} aria-hidden="true" data-testid="hwg-nav-auth" data-state="loading" />;
  if (!isSignedIn) {
    return (
      <div className={BOX} data-testid="hwg-nav-auth" data-state="signed-out">
        <Link href="/sign-in?redirect_url=%2Fhow-we-grade" className={cn(buttonVariants({ variant: "secondary" }), SMALL)}>
          Sign In
        </Link>
        <Link href="/pricing" className={cn(buttonVariants({ variant: "primary" }), SMALL, "[@media(max-width:600px)]:hidden")}>
          Start Free Trial
        </Link>
      </div>
    );
  }
  const name = user?.username ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "";
  return (
    <div className={BOX} data-testid="hwg-nav-auth" data-state="signed-in">
      <Link href="/play" className={cn(buttonVariants({ variant: "primary" }), SMALL)}>
        Play
      </Link>
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cb-border-strong bg-cb-fill font-mono text-label text-cb-text-soft"
      >
        {user?.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- the Clerk avatar URL, 32 px, decorative
          <img src={user.imageUrl} alt="" width={32} height={32} className="size-full object-cover" />
        ) : (
          initialsOf(name || "You")
        )}
      </span>
    </div>
  );
}
