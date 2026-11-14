// The request clock is the only clock (phase-05 plan §7 intro, §8.4, §12.1 clock.test.ts): every exported Train, Home
// and reports service takes `now` from its caller and gives the same statements (text and bound values) and the same
// result for the same `now` whatever the wall clock says. Each service runs twice against a recording database stub,
// under two different mocked wall clocks (`Date` and `Date.now`); the only bound values allowed to differ are freshly
// minted refs (`newGameRef`, a cuid shape). Plus: the ESLint rule that bans `Date.now()` / `new Date()` in
// lib/train/**, lib/home/** and lib/reports/** is active (a lint fixture).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, mock } from "node:test";
import type { Prisma } from "@repo/db";
import { ESLint } from "eslint";
import { installTestDeps } from "../../test/helpers/route-harness";
import { getHomeData } from "../home/home.server";
import { createReport } from "../reports/reports.server";
import { applyAttempts } from "./attempts.server";
import { getBadges } from "./badges.server";
import { listBank } from "./bank.server";
import { removeCard, skipCard } from "./cards.server";
import type { TrainDb, TrainDeps } from "./db.server";
import { setMomentInBank } from "./links.server";
import { updatePrefs } from "./prefs.server";
import { endSession, extendSession, getSession, getSessionSummary, openSession } from "./sessions.server";
import { listThemes } from "./themes.server";
import { getTrainToday } from "./today.server";
import { viewerFixture } from "../../test/helpers/route-harness";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const WALL_CLOCKS = [Date.parse("2031-01-01T00:00:00.000Z"), Date.parse("2019-06-30T13:37:00.000Z")];
const REF = /^c[a-z0-9]{20,31}$/;

type Recorded = { text: string; values: unknown[] }[];

function recordingDeps(log: Recorded): TrainDeps {
  const db: TrainDb = {
    $queryRaw: <T>(sql: Prisma.Sql) => {
      log.push({ text: sql.text, values: sql.values.map((v) => (typeof v === "string" && REF.test(v) ? "<ref>" : v)) });
      return Promise.resolve([] as unknown as T);
    },
    $executeRaw: (sql: Prisma.Sql) => {
      log.push({ text: sql.text, values: sql.values.map((v) => (typeof v === "string" && REF.test(v) ? "<ref>" : v)) });
      return Promise.resolve(0);
    },
  };
  return { db, tx: (fn) => fn(db) };
}

const viewer = viewerFixture({ id: 42n, ref: "cviewer00000000000000000000", user: { name: "clock", timeZone: "America/New_York" } });

const SERVICES: Record<string, (deps: TrainDeps) => Promise<unknown>> = {
  getTrainToday: (d) => getTrainToday(viewer, NOW, d),
  listBank: (d) => listBank(viewer, { view: "all" }, null, NOW, d),
  listThemes: (d) => listThemes(viewer, d),
  getHomeData: (d) => getHomeData(viewer, NOW, d),
  getBadges: (d) =>
    getBadges(
      { $queryRawUnsafe: <T>(text: string, ...values: unknown[]) => d.db.$queryRaw<T>({ text, values } as unknown as Prisma.Sql) },
      { id: viewer.id, timeZone: "America/New_York" },
      NOW,
    ),
  applyAttempts: (d) =>
    applyAttempts(
      viewer,
      [
        {
          clientAttemptId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
          sessionRef: null,
          itemId: null,
          cardRef: "m_abc",
          puzzleId: null,
          kind: "mistake",
          solved: true,
          firstTry: true,
          hintsUsed: 0,
          wrongMovesUci: [],
          solutionShown: false,
          timeMs: 1000,
          grade: "good",
          suggestedGrade: "good",
          cardReps: 1,
          reviewedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        },
      ],
      NOW,
      d,
    ),
  skipCard: (d) => skipCard(viewer, "m_abc", null, NOW, d),
  removeCard: (d) => removeCard(viewer, "m_abc", NOW, d),
  updatePrefs: (d) => updatePrefs(viewer, { releaseHour: 9 }, d),
  createReport: (d) => createReport(viewer, { targetType: "mistake", targetRef: "cm5m1st4k0001slzpmistake1", reason: "other", fen: "8/8/8/8/8/8/8/K6k w - - 0 1" }, NOW, d),
  openSession: (d) => openSession(viewer, { kind: "bank", source: "hub", practice: false }, NOW, d),
  getSession: (d) => getSession(viewer, "cm5t9s3ss0001slzpbankdrl1", NOW, d),
  extendSession: (d) => extendSession(viewer, "cm5t9s3ss0001slzpbankdrl1", "i10", NOW, d),
  endSession: (d) => endSession(viewer, "cm5t9s3ss0001slzpbankdrl1", "done", NOW, d),
  getSessionSummary: (d) => getSessionSummary(viewer, "cm5t9s3ss0001slzpbankdrl1", NOW, d),
  setMomentInBank: (d) => setMomentInBank(viewer, "cm3k9x2p10007slzpqa8hd4fe", 36, true, NOW, d),
};

async function runAt(wallMs: number, service: (deps: TrainDeps) => Promise<unknown>): Promise<{ log: Recorded; out: string }> {
  const log: Recorded = [];
  mock.timers.enable({ apis: ["Date"], now: wallMs });
  const t = installTestDeps({ clock: NOW.getTime() });
  try {
    const out = await service(recordingDeps(log)).then(
      (v) => JSON.stringify(v, (_k, x) => (typeof x === "string" && REF.test(x) ? "<ref>" : typeof x === "bigint" ? x.toString() : x)),
      (e: unknown) => `throws ${e instanceof Error ? `${e.name}:${(e as { code?: string }).code ?? e.message}` : String(e)}`,
    );
    return { log, out };
  } finally {
    t.restore();
    mock.timers.reset();
  }
}

describe("the request clock is the only clock", () => {
  for (const [name, service] of Object.entries(SERVICES)) {
    it(`${name}: the same statements and result under two wall clocks`, async () => {
      const [a, b] = [await runAt(WALL_CLOCKS[0]!, service), await runAt(WALL_CLOCKS[1]!, service)];
      assert.ok(a.log.length > 0, `${name} ran no statement`);
      assert.deepEqual(b.log, a.log, `${name}: a statement depends on the wall clock`);
      assert.equal(b.out, a.out, `${name}: the result depends on the wall clock`);
    });
  }

  it("the lint rule bans the wall clock in lib/train, lib/home and lib/reports", async () => {
    const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const eslint = new ESLint({ cwd: web });
    for (const file of ["lib/train/clock-fixture.server.ts", "lib/home/clock-fixture.server.ts", "lib/reports/clock-fixture.server.ts"]) {
      const [result] = await eslint.lintText("export const a = Date.now();\nexport const b = new Date();\n", { filePath: path.join(web, file) });
      const clock = (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax" && /Take `now` from the caller/.test(m.message));
      assert.equal(clock.length, 2, `${file}: ${JSON.stringify(result?.messages.map((m) => m.ruleId))}`);
    }
  });
});
