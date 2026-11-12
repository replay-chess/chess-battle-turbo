// Who may read a review (phase-03 plan §7 "Auth contexts", §11.1; B26). The read endpoints (A1, A2, A8, A9) are
// registered `auth: "user"` and call this gate, so the flag `review-lapsed-read` can open them to lapsed members
// without touching route(). With the flag off (the default, owner decision P3-Q1) the answer is exactly what
// `auth: "member"` gives: members and admins pass (perf runs with the bypass token too), everyone else gets 402 with
// `details.reason`. The player check (404) happens in the statement that loads the game.
import type { NextRequest } from "next/server";
import { getRouteDeps } from "@/lib/api/context";
import { memberDenied } from "@/lib/api/route";
import { isPerfBypassRequest } from "@/lib/auth/secrets";
import type { Viewer } from "@/lib/auth/viewer";

export type LapsedReadFlag = (viewer: Viewer) => Promise<boolean>;

const defaultLapsedReadFlag: LapsedReadFlag = async (viewer) => {
  const { getFlags } = await import("@/lib/flags");
  return (await getFlags(viewer))["review-lapsed-read"];
};

let lapsedReadFlag: LapsedReadFlag = defaultLapsedReadFlag;

/** Test seam for the flag; returns a restore function. */
export function setLapsedReadFlag(next: LapsedReadFlag): () => void {
  const previous = lapsedReadFlag;
  lapsedReadFlag = next;
  return () => {
    lapsedReadFlag = previous;
  };
}

/** The viewer when they may read reviews; throws the 402 otherwise. Flags are evaluated for lapsed viewers only. */
export async function requireReviewReader(ctx: { viewer: Viewer | null; req: NextRequest }): Promise<Viewer> {
  const viewer = ctx.viewer;
  if (!viewer) throw new Error("requireReviewReader: route() did not load a viewer");
  const deps = getRouteDeps();
  if (viewer.entitlement.member || isPerfBypassRequest(ctx.req, deps.env)) return viewer;
  if (viewer.entitlement.state === "lapsed" && (await lapsedReadFlag(viewer))) return viewer;
  throw memberDenied(deps.memberDenialReason(viewer));
}

export function isAdmin(viewer: Pick<Viewer, "role">): boolean {
  return viewer.role === "admin";
}
