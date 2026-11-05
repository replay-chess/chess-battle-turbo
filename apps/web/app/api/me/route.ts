// GET /api/me (plan §7.4 A3, §5.2): the signed-in viewer as MeData. One getViewer() (route() loads it: one statement)
// plus getFlags() (PostHog local evaluation, no network when warm). Declared side effect `provision_user`: a first
// request that beats the Clerk user.created webhook creates the users row (lib/auth/provision-user.ts); a Clerk user
// without a verified email gets 502 upstream_unavailable { provider: "clerk", kind } from the viewer loader.
// Cache tier private-etag: `private, no-cache` + a strong ETag, so a focus refetch with no change is a 304.
import { meEndpoints } from "@repo/contracts/http/registry";
import { serverBuildId } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { getFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";

export const GET = route(meEndpoints.get, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const viewer = ctx.viewer!;
  const flags = await getFlags(viewer);
  ctx.timing.mark("flags");
  return meDataOf(viewer, flags, serverBuildId());
});
