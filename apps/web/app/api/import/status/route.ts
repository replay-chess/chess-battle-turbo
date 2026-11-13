// ACC-7 `GET /api/import/status` (phase-04 plan §7.4, §5.7; D4-31). The viewer's newest five runs and the first
// imported review, ONE statement (lib/data/imports.ts). `private-etag`: the fallback poller's revalidation of an
// unchanged status is a 304. Never enqueues: when a run has sat QUEUED for more than 30 s, `after()` runs P3's kick
// compare-and-set on its `import:<id>` job (the registered side effect `kick_cas`): at most one kick per job per 30 s
// across every instance and tab. A member whose run is still WAITING_FOR_MEMBERSHIP gets the fan-out's release in
// `after()` (the registered side effect `release_waiting`, FIX-1). `import-v3` off → 404.
import { importEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { requireImportFlag } from "@/lib/accounts/flag";
import { getImportStatus } from "@/lib/data/imports";
import { rawDb } from "@/lib/games/snapshot.server";
import { healImportKick, kickImports, releaseWaitingImports } from "@/lib/jobs/import";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(importEndpoints.status, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const db = rawDb(prisma);
  const status = await getImportStatus(viewer, { db, now: ctx.now });
  if (status.staleQueued.length) {
    ctx.after(async () => {
      for (const id of status.staleQueued) await healImportKick(db, id).catch(() => false);
    });
  }
  // A member whose run is still parked: the payment's fan-out release was lost (after() is best effort) or raced the
  // link that parked it. The same idempotent release + kick, after the response (registered `release_waiting`; FIX-1).
  // The worker's backstop sweep does the same for members who never open the app (import-backstop.ts).
  if (status.waiting && viewer.entitlement.member) {
    ctx.after(async () => {
      const { released, queued } = await releaseWaitingImports(db, viewer.id, { now: ctx.now });
      if (released + queued > 0) await kickImports("import");
    });
  }
  return status.data;
});
