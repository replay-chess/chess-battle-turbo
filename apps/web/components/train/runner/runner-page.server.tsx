// The two runner pages' server half (phase-05 plan §5.2 S4/S5 "First paint"): `?s=` resumes through `getSession`
// (404 for another member's ref); otherwise the URL's spec creates or resumes a session through the same service as
// W2 (`openSession`: idempotent by filterKey + ACTIVE < 2 h, counted against the durable `train-session`
// limit). The created session's URL becomes `?s=<ref>` on the client with history.replaceState (no second render; a
// reload resumes). A router prefetch (`Next-Router-Prefetch` / `Purpose: prefetch`) renders the skeleton only and never
// calls the service: a prefetch must never create a session (links to these URLs are prefetch={false} anyway).
import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SessionCreate, type SessionPayload } from "@repo/contracts/http/train";
import { ApiError } from "@/lib/api/api-error";
import { requestNow } from "@/lib/api/now";
import { requireMemberPage } from "@/lib/auth/require-member-page";
import { getFlags } from "@/lib/flags";
import { getSession, openSession } from "@/lib/train/sessions.server";
import { bankSpec, puzzlesSpec, resumeRef, returnPath, specSource, wantsPicker, type SearchParams } from "@/features/train/session-spec";
import { RunnerSkeleton } from "./RunnerSkeleton";
import { SessionError } from "./SessionError";
import { sessionErrorKindOf, type SessionErrorKind } from "./session-error-kind";
import { TrainerRunner } from "./TrainerRunner";

export type RunnerRoute = "/train/bank/session" | "/train/puzzles";

/** A router prefetch or a browser speculation (never a real visit). */
export function isPrefetchRequest(h: { get(name: string): string | null }): boolean {
  return h.get("next-router-prefetch") === "1" || /prefetch/i.test(h.get("purpose") ?? "") || /prefetch/i.test(h.get("sec-purpose") ?? "");
}

function errorKind(err: unknown): { kind: SessionErrorKind; retryAfterSec: number | null } | null {
  return err instanceof ApiError ? sessionErrorKindOf(err) : null;
}

export async function RunnerPage({ route, searchParams }: { route: RunnerRoute; searchParams: SearchParams }) {
  const h = await headers();
  if (isPrefetchRequest(h)) return <RunnerSkeleton />;
  const viewer = await requireMemberPage({ returnTo: returnPath(route, searchParams) });
  const flags = await getFlags(viewer);
  if (!flags.train) notFound(); // the flag registry: off → /train/** pages 404

  const ref = resumeRef(searchParams);
  const spec = route === "/train/puzzles" ? puzzlesSpec(searchParams) : bankSpec(searchParams);
  let payload: SessionPayload;
  let created = false;
  try {
    const now = await requestNow();
    if (ref) payload = await getSession(viewer, ref, now);
    else ({ payload, created } = await openSession(viewer, SessionCreate.parse(spec), now));
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") notFound();
    const e = errorKind(err);
    if (e) return <SessionError kind={e.kind} retryAfterSec={e.retryAfterSec} />;
    throw err;
  }
  // A finished session's resume URL shows its summary (§4.7: /train/session/[ref] does the same).
  if (ref && payload.status !== "active") redirect(`/train/session/${encodeURIComponent(payload.ref)}/summary`);
  return (
    <TrainerRunner
      key={payload.ref}
      payload={payload}
      userRef={viewer.ref}
      source={ref ? "deeplink" : specSource(spec)}
      created={created}
      initialThemesOpen={route === "/train/puzzles" && wantsPicker(searchParams)}
    />
  );
}
