// /dev/import (phase-04 plan §7.7.4, §4.12; testing X12): the provider fault table of the analysis worker, for
// testing the import's failure states on dev (Chess.com / Lichess answering 503, 429 or never). Admin only, and only
// when `testHooksEnabled()` (NEXT_PUBLIC_APP_ENV dev/test AND ALLOW_TEST_HOOKS=1); app/dev/layout.tsx already 404s
// outside dev (devRoutesEnabled). Everyone else gets the same 404 (prod-guard.spec.ts proves it in production).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FAULT_TTL_MAX_SEC } from "@repo/contracts/internal/provider";
import { PageHeader } from "@/components/ui/page-header";
import { getViewer } from "@/lib/auth/viewer";
import { testHooksEnabled } from "@/lib/env-server";
import { FaultPanel } from "./FaultPanel";

export const metadata: Metadata = { title: "Import Faults", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DevImportPage() {
  if (!testHooksEnabled()) notFound();
  const viewer = await getViewer();
  if (viewer?.role !== "admin") notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageHeader overline="Dev · test hook" title="Import faults" />
      <p className="text-sm text-cb-text-muted">
        The worker answers every call to one provider with a synthetic 503, a 429 (Retry-After 30 s) or no answer at
        all, for at most 10 minutes. Imports and the Chess.com lookup fallback both see it; nothing reaches the real
        provider while it is on.
      </p>
      <FaultPanel ttlMaxSec={FAULT_TTL_MAX_SEC} />
    </main>
  );
}
