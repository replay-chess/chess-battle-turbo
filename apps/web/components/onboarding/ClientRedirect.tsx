"use client";

// A redirect decided inside a streamed <Suspense> boundary (the Confirm step's preview: the profile is gone, or
// another member holds it). A server redirect() thrown after the fallback streamed breaks the dev router (P2 FIX-A),
// so the boundary renders this instead: router.replace on mount, plus a plain link for no-JS.
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return (
    <p className="onb-hint" role="status" data-testid="onb-client-redirect">
      <Link href={to}>Continue</Link>
    </p>
  );
}
