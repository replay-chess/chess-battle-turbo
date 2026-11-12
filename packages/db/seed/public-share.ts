// A live public share for the Lighthouse gate of `/r/<code>` (phase-03 plan G5 acceptance "Lighthouse ≥ 95 on
// /r/[code]"; FIX-1). The nightly `lighthouse` job has no Clerk users, so this seed makes its own synthetic sharer (no
// Clerk identity, never signs in) with member A's design GAME (the same fixture, a different owner) and one live share
// whose code is fixed on every database: PUBLIC_SHARE_CODE. A re-run re-dates the link when it is about to expire.
//
//   pnpm --filter @repo/db exec tsx seed/public-share.ts --apply      (a local Postgres or the dev branch only)
import type { PrismaClient } from "#generated";
import { MAX_TARGET_USERS } from "../prisma/seed-guards";
import { createPrismaClient } from "../src/client";
import { liveShare, type SeedFixture } from "./builders";
import { gameFixture, SEED_OPPONENTS } from "./review";
import { checkTripwire, isEntryPoint, parseFlags, reportFailure, resolveWriteTarget } from "./target";
import {
  ensureSeedUser,
  fixtureAction,
  placeholderMember,
  readFixtureStates,
  readShares,
  sharesToWrite,
  writeFixtures,
  writeShares,
  type SeedUserSpec,
} from "./writer";

export const PUBLIC_SHARE_USER = {
  email: "share-p3@replaychess.local",
  code: "SEED_P3_SHARER",
  googleId: "seed_p3_sharer",
  name: "share_p3",
  rating: 1184,
} as const satisfies SeedUserSpec;

export function publicShareFixture(member: Parameters<typeof gameFixture>[0]["member"], talFan: Parameters<typeof gameFixture>[0]["talFan"]): SeedFixture {
  return gameFixture({ member, talFan });
}

/** The scope of the share code: a constant, so the code is the same on every database (the members' refs are not). */
export const PUBLIC_SHARE_SCOPE = "public-share";

/** The fixed code of the seeded live share. */
export function publicShareCode(): string {
  const f = publicShareFixture(placeholderMember(PUBLIC_SHARE_USER), placeholderMember(SEED_OPPONENTS.talFan));
  return liveShare(f, "w", PUBLIC_SHARE_SCOPE, new Date(0)).code;
}

export async function runPublicShareSeed(
  db: PrismaClient,
  opts: { apply: boolean; now?: Date },
): Promise<{ code: string; game: "insert" | "update" | "unchanged"; share: "write" | "unchanged" }> {
  const now = opts.now ?? new Date();
  const sharer = await ensureSeedUser(db, PUBLIC_SHARE_USER, opts.apply);
  const tal = await ensureSeedUser(db, SEED_OPPONENTS.talFan, opts.apply);
  const fixture = publicShareFixture(sharer.member ?? placeholderMember(PUBLIC_SHARE_USER), tal.member ?? placeholderMember(SEED_OPPONENTS.talFan));
  const stored = await readFixtureStates(db, [fixture.game.ref]);
  const action = fixtureAction(fixture, stored.get(fixture.game.ref)).action;
  const share = { ...liveShare(fixture, "w", PUBLIC_SHARE_SCOPE, now), kind: "live" as const };
  const toWrite = action !== "unchanged" ? [share] : sharesToWrite([share], await readShares(db, [share.code]), now);
  if (opts.apply) {
    if (action !== "unchanged") await writeFixtures(db, [fixture]);
    if (toWrite.length) await writeShares(db, toWrite);
  }
  return { code: share.code, game: action, share: toWrite.length ? "write" : "unchanged" };
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2), { booleans: ["--apply"], values: [] });
  const apply = flags.has("--apply");
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const r = await runPublicShareSeed(db, { apply });
    console.log(`game     ${r.game}`);
    console.log(`share    ${r.share}  /r/${r.code}`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("seed/public-share", err));
