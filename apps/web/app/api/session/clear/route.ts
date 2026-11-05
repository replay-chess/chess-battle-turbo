// POST /api/session/clear (plan §7.4 A18, CA AP-04). signOutEverywhere() calls it before clerk.signOut(): the
// browser drops its HTTP cache for this origin, so the next user on a shared device never sees the previous user's
// revalidated responses. Never `"storage"`: that would wipe the offline outboxes (P5).
import { systemEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const POST = route(systemEndpoints.sessionClear, async () =>
  respondWith(undefined, { headers: { "Clear-Site-Data": '"cache"' } }),
);
