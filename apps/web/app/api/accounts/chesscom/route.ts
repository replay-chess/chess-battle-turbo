// ACC-3 `POST /api/accounts/chesscom` (phase-04 plan §7.3.2, §7.3.3, §8.15; D4-07, D4-10, D4-15). Links a Chess.com
// account (unverified) and creates its first import run: QUEUED with the IMPORT_SYNC job when the member is entitled,
// else WAITING_FOR_MEMBERSHIP (the entitlement fan-out releases it). `context: "onboarding"` also moves the step to
// LEVEL and stores the band suggestion in the same transaction. `Idempotency-Key` (UUID v4) is required: a replay
// answers the stored response with `Idempotent-Replayed: true`. 201 a new link, 200 the same handle again; 404 unknown
// handle; 409 `profile_closed`, `already_linked`, `linked_elsewhere`. After the response: kick, the legacy
// chess_com_profiles dual-write, audit rows (`account.linked`, `account.link_coclaim`), the `chesscom:<u>` tag and
// the `account_linked` event.
//
// PATCH and DELETE of `/api/accounts/chesscom` land here too: a static segment wins over `[provider]` in the App
// Router, so this file hands them to `../[provider]/route.ts` with `{ provider: "chesscom" }`.
import type { NextRequest } from "next/server";
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { IDEMPOTENCY_REPLAYED_HEADER, readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { chesscomLookup, lookupKey } from "@/lib/accounts/chesscom";
import { runLinkEffects } from "@/lib/accounts/effects";
import { requireImportFlag } from "@/lib/accounts/flag";
import { linkChessCom } from "@/lib/accounts/link-service";
import { DataError } from "@/lib/data/errors";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";
import { DELETE as deleteProvider, PATCH as patchProvider } from "../[provider]/route";
import type { LinkData } from "@repo/contracts/http/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const POST = route(accountsEndpoints.linkChessCom, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const key = readIdempotencyKey(ctx.req.headers, { required: true })!;
  const username = lookupKey(ctx.body.username);
  const run = async (): Promise<{ status: number; body: LinkData }> => {
    const { value } = await chesscomLookup(username);
    if (value.kind === "not_found") throw new DataError("not_found");
    if (value.kind === "private") throw new DataError("conflict", { details: { reason: "profile_closed" } });
    const out = await linkChessCom({ viewer, profile: value.profile, stats: value.stats, context: ctx.body.context, now: ctx.now });
    ctx.after(() => runLinkEffects(out.effects, { viewer, requestId: ctx.requestId, now: ctx.now }));
    return { status: out.status, body: out.data };
  };
  const out = await withIdempotency(
    rawDb(prisma),
    { userId: viewer.id, key, route: accountsEndpoints.linkChessCom.id, hash: requestHash({ username, context: ctx.body.context }), now: ctx.now },
    run,
  );
  return respondWith(out.body, {
    status: out.status === 201 ? 201 : 200,
    ...(out.replayed ? { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" } } : {}),
  });
});

const CHESSCOM = { params: Promise.resolve({ provider: "chesscom" }) };

/** ACC-5 for Chess.com (see the header): the `[provider]` handler with the static segment as its param. */
export function PATCH(req: NextRequest): Promise<Response> {
  return patchProvider(req, CHESSCOM);
}

/** ACC-6 for Chess.com (see the header). */
export function DELETE(req: NextRequest): Promise<Response> {
  return deleteProvider(req, CHESSCOM);
}
