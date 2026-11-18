// The completed session of the `dev-perfect` persona (`seed-training.ts --persona perfect`), written by the product's
// own functions instead of by hand: W2 `openSession` builds the due-queue BANK session the hub's Mistake Bank card
// starts, W1 `applyAttempts` grades every item solved on the first try (Good), and W4 `endSession` completes it. So the
// cards are rescheduled, today's `training_days` counters, the streak, theme mastery and today's plan bits are exactly
// what a member who really finished that session has (staging README §5 item 4: the hand-written session left its
// cards due and `bankReviewed` at 0, so the hub said "Done for today" beside "Mistake Bank 4 due").
//
// It runs after the persona writer's transaction (`writeP05Persona` calls it through `P05WriteOptions.session`), on the
// writer's own client, ten minutes before `now`, with deterministic attempt ids (seededUuid). The persona tool runs it
// in a tsx child (./p05-session-child.ts): the train services import the route context, which imports `next/server`,
// and Playwright's loader (leasePersona) cannot resolve that outside Next (as ./p06-deps.ts notes).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@repo/db";
import type { AttemptIn } from "@repo/contracts/http/train";
import type { PersonaSessionInput } from "@repo/db/seed/p05-personas";
import { seededUuid } from "@repo/db/seed/p05-personas";
import { readViewerRecordById, toViewer } from "../../lib/auth/viewer";
import { rawDb } from "../../lib/games/snapshot.server";
import { applyAttempts } from "../../lib/train/attempts.server";
import { TRAIN_TX_OPTIONS, type TrainDeps } from "../../lib/train/db.server";
import { endSession, openSession } from "../../lib/train/sessions.server";

const MIN = 60_000;

/** The train services on the writer's client (not the app's pooled one: the persona tool targets its own URL). */
function depsOf(db: PrismaClient): TrainDeps {
  return { db: rawDb(db), tx: (fn) => db.$transaction((client) => fn(rawDb(client)), TRAIN_TX_OPTIONS) };
}

/** Opens, grades (all first try, Good) and completes the member's due BANK session; returns the attempts written. */
export async function completePersonaSession(db: PrismaClient, input: PersonaSessionInput): Promise<{ attempts: number; sessionRef: string }> {
  const record = await readViewerRecordById(db, input.userId);
  if (!record) throw new Error(`[personas] no users row ${input.userId} for the persona session`);
  // The train services read the member's id, ref, zone and onboarding only; membership is the persona tool's business
  // (no catalog: lib/billing/products is server-only).
  const viewer = toViewer(record, { now: input.now, paywallEnabled: false, catalog: { monthly: null, yearly: null } });
  const deps = depsOf(db);
  const startedAt = new Date(input.now.getTime() - 10 * MIN);
  const { payload } = await openSession(viewer, { kind: "bank", source: "hub", practice: false }, startedAt, deps);
  const items = payload.items.filter((it) => it.pass === 1);
  if (items.length === 0) throw new Error(`[personas] ${input.persona}: nothing is due, so there is no session to complete`);
  let attempts = 0;
  for (const [i, it] of items.entries()) {
    const reviewedAt = new Date(startedAt.getTime() + (i + 1) * MIN);
    const attempt: AttemptIn = {
      clientAttemptId: seededUuid(`${input.userRef}:${input.persona}:session:${i}`),
      sessionRef: payload.ref,
      itemId: it.itemId,
      cardRef: it.cardRef,
      puzzleId: it.puzzleId,
      kind: it.kind,
      solved: true,
      firstTry: true,
      hintsUsed: 0,
      wrongMovesUci: [],
      solutionShown: false,
      timeMs: 18_000,
      grade: "good",
      suggestedGrade: "good",
      cardReps: it.cardReps,
      reviewedAt: reviewedAt.toISOString(),
    };
    const out = await applyAttempts(viewer, [attempt], new Date(reviewedAt.getTime() + 1_000), deps);
    const status = out.result.results[0]?.status;
    if (status !== "ok") throw new Error(`[personas] ${input.persona}: grading ${it.cardRef} answered ${String(status)}`);
    attempts++;
  }
  await endSession(viewer, payload.ref, "done", new Date(startedAt.getTime() + (items.length + 1) * MIN), deps);
  return { attempts, sessionRef: payload.ref };
}

/** The child entry (./p05-session-child.ts): `tsx p05-session.ts <userId> <userRef> <persona> <nowIso>`, the target in
 * PERSONA_SESSION_DATABASE_URL; prints `{"attempts": n}`. */
async function main() {
  const [userId, userRef, persona, nowIso] = process.argv.slice(2);
  const url = process.env.PERSONA_SESSION_DATABASE_URL;
  if (!userId || !userRef || !persona || !nowIso || !url) throw new Error("usage: p05-session.ts <userId> <userRef> <persona> <nowIso> (PERSONA_SESSION_DATABASE_URL set)");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const out = await completePersonaSession(db, { userId: BigInt(userId), userRef, persona, now: new Date(nowIso) });
    process.stdout.write(`${JSON.stringify({ attempts: out.attempts })}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
