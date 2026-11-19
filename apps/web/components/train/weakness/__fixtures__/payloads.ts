// Weakness Profile payload fixtures (phase-06 plan §4, §7.6, §13 WP1): every page state of the design boards, built
// by the real `buildPayload()` from the golden snapshot (`member-design.golden.json`: `computeWeakness()` over 212
// synthesised games with the synthetic baseline; it reproduces the V3WeaknessProfile numbers). For the demo route
// `/dev/ui/weakness?state=&lesson=1&stress=1` and component tests only: every user-visible state is also reached from
// rows in Postgres (the leased personas, WP8). `lesson` fills the P8 slots; `stress` uses the longest labels, names
// and 3-digit counts the contract allows (TE X9).
import type { WeaknessLesson, WeaknessPayload } from "@repo/contracts/http/weakness";
import golden from "@repo/chess-training/fixtures/weakness/member-design.golden.json";
import noBandGolden from "@repo/chess-training/fixtures/weakness/member-design.no-band.golden.json";
import { buildPayload, type PayloadInput, type PayloadProbe, type PayloadSnapshot } from "@repo/chess-training/weakness/payload";
import type { WeaknessMetricsV1 } from "@repo/chess-training/weakness/types";

export const WEAKNESS_FIXTURE_NOW = new Date("2026-11-16T10:00:00.000Z");
export const WEAKNESS_FIXTURE_TZ = "Europe/London";

/** The states the boards and the plan's sub-states name (§4.4–§4.8). */
export const WEAKNESS_FIXTURE_STATES = [
  "ready",
  "ready_updating",
  "few_patterns",
  "none_eligible",
  "no_band",
  "no_clock",
  "insufficient_zero",
  "insufficient_few",
  "insufficient",
  "bullet_offer",
  "computing",
  "computing_stalled",
  "computing_orphaned",
  "computing_almost",
  "failed",
  "paused",
] as const;
export type WeaknessFixtureState = (typeof WEAKNESS_FIXTURE_STATES)[number];

const metrics = (golden as unknown as { metrics: WeaknessMetricsV1 }).metrics;
/** FIX-4 (D-P6-FIX4-4): the same member with no rated games, as `computeWeakness()` writes it (compute.golden test). */
const noBandMetrics = (noBandGolden as unknown as { metrics: WeaknessMetricsV1 }).metrics;

/** The design's legend lessons (P8 lights the slots; shown only with `lesson`). */
export const FIXTURE_LESSONS: Readonly<Record<string, WeaknessLesson>> = {
  fork: { slug: "tal-vs-smyslov-1959", title: "Tal vs Smyslov, 1959", sub: "A world champion’s forks, then play it out" },
  hangingPiece: { slug: "morphy-opera-game-1858", title: "Morphy’s Opera Game, 1858", sub: "Every piece defended, every piece working" },
  "rc:timePressure": { slug: "fischer-vs-taimanov-1971", title: "Fischer vs Taimanov, 1971", sub: "Calm moves with the clock running" },
};

const PROFILE = { weaknessTimeClasses: [] as string[], weaknessMonths: 0, puzzleRating: 1512, weaknessVersion: 3, lastWeaknessSeenVersion: 2 };
const IN_BANK = { fork: 12, hangingPiece: 7, "rc:timePressure": 4, "rc:development": 3, pin: 5 };
const IDLE: PayloadProbe = { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, games: null, importRun: null, lastAnalysedAt: null };

function snapshot(m: WeaknessMetricsV1, status: PayloadSnapshot["status"] = "READY"): PayloadSnapshot {
  return { weekStart: "2026-11-16", algoVersion: 1, status, gamesInScope: m.games.inScope, gamesAnalysed: m.games.analysed, metrics: m, computedAt: WEAKNESS_FIXTURE_NOW };
}

/** An INSUFFICIENT row as the worker writes it (no rows, no breakdown; the preliminary list from 5 analysed). */
function insufficientMetrics(analysed: number, inScope: number, preliminary: WeaknessMetricsV1["preliminary"]): WeaknessMetricsV1 {
  return {
    ...metrics,
    games: { inScope, analysed, excludedBot: 0 },
    rows: [],
    topKeys: [],
    preliminary,
    headline: null,
    breakdown: null,
  };
}

function build(o: Partial<PayloadInput>): WeaknessPayload {
  return buildPayload({
    now: WEAKNESS_FIXTURE_NOW,
    timeZone: WEAKNESS_FIXTURE_TZ,
    snapshot: snapshot(metrics),
    profile: PROFILE,
    inBank: IN_BANK,
    probe: IDLE,
    isTrialing: false,
    secPerGame: 45,
    lanes: 1,
    ...o,
  });
}

const games = (blitz: number, rapid: number, analysedBlitz: number, analysedRapid: number, bullet = 0): NonNullable<PayloadProbe["games"]> => [
  { timeClass: "BLITZ", n: blitz, analysed: analysedBlitz },
  { timeClass: "RAPID", n: rapid, analysed: analysedRapid },
  ...(bullet > 0 ? [{ timeClass: "BULLET", n: bullet, analysed: 0 }] : []),
];

function byState(state: WeaknessFixtureState): WeaknessPayload {
  switch (state) {
    case "ready":
      return build({});
    case "ready_updating":
      // 4 games analysed since the design snapshot (212 analysed; FIX-2: every in-scope game of the design member is).
      return build({ probe: { ...IDLE, recompute: "queued", activeAnalyzeJobs: 4, games: games(132, 84, 132, 84) } });
    case "few_patterns":
      return build({ snapshot: snapshot({ ...metrics, rows: metrics.rows.slice(0, 2), topKeys: metrics.topKeys.slice(0, 2) }) });
    case "none_eligible":
      return build({
        snapshot: snapshot({
          ...metrics,
          listMode: "most_frequent",
          rows: metrics.rows.slice(0, 3).map((r) => ({ ...r, band: null, lossBand100: null, ratio: null, z: null, score: r.lossYou100 })),
          headline: {
            text: "Nothing stands out against players at your level. Your mistakes are spread across many patterns.",
            short: "Nothing stands out against players at your level. Your mistakes are spread across many patterns.",
            claims: [],
          },
        }),
      });
    case "no_band":
      // The engine's own output for a member without a rating band (no hand-edited copy of the band profile, which
      // kept band values in the phase rows and a sentence comparing with them: FIX-4 item 4).
      return build({ snapshot: snapshot(noBandMetrics) });
    case "no_clock":
      return build({
        snapshot: snapshot({
          ...metrics,
          rows: metrics.rows.filter((r) => r.pattern !== "rc:timePressure"),
          topKeys: metrics.rows.filter((r) => r.pattern !== "rc:timePressure").slice(0, 3).map((r) => r.pattern),
          headline: { text: "You lose most points to missed forks in the middlegame.", short: "You lose most points to missed forks in the middlegame.", claims: [{ k: "pattern", key: "fork" }, { k: "phase", phase: "middlegame" }] },
          breakdown: metrics.breakdown ? { ...metrics.breakdown, clock: null } : null,
        }),
      });
    case "insufficient_zero":
      return build({ snapshot: null, probe: { ...IDLE, games: [] }, profile: { ...PROFILE, weaknessVersion: 0, lastWeaknessSeenVersion: 0 } });
    case "insufficient_few":
      return build({ snapshot: snapshot(insufficientMetrics(3, 3, []), "INSUFFICIENT"), probe: { ...IDLE, games: games(2, 1, 2, 1) } });
    case "insufficient":
      return build({
        snapshot: snapshot(
          insufficientMetrics(14, 14, [
            { pattern: "fork", label: "Missed forks", seenIn: 5, of: 14 },
            { pattern: "hangingPiece", label: "Missed free pieces", seenIn: 3, of: 14 },
          ]),
          "INSUFFICIENT",
        ),
        probe: { ...IDLE, games: games(9, 5, 9, 5) },
        isTrialing: true,
      });
    case "bullet_offer":
      return build({ snapshot: snapshot(insufficientMetrics(8, 8, []), "INSUFFICIENT"), probe: { ...IDLE, games: games(8, 0, 8, 0, 64) } });
    case "computing":
      return build({
        snapshot: null,
        probe: { ...IDLE, activeAnalyzeJobs: 51, games: games(36, 24, 6, 3), importRun: { done: 212, total: 480, ratePerSec: 2.5 }, lastAnalysedAt: new Date(WEAKNESS_FIXTURE_NOW.getTime() - 40_000) },
      });
    case "computing_stalled":
      return build({
        snapshot: null,
        probe: { ...IDLE, activeAnalyzeJobs: 51, games: games(36, 24, 6, 3), importRun: null, lastAnalysedAt: new Date(WEAKNESS_FIXTURE_NOW.getTime() - 14 * 60_000) },
      });
    case "computing_orphaned":
      return build({ snapshot: null, probe: { ...IDLE, games: games(14, 8, 14, 8) } });
    case "computing_almost":
      return build({ snapshot: null, probe: { ...IDLE, recompute: "running", activeAnalyzeJobs: 40, games: games(130, 82, 12, 8), lastAnalysedAt: new Date(WEAKNESS_FIXTURE_NOW.getTime() - 30_000) } });
    case "failed":
      return build({
        snapshot: snapshot({ ...insufficientMetrics(22, 22, []), failure: { code: "compute_error", at: WEAKNESS_FIXTURE_NOW.toISOString() } }, "FAILED"),
        probe: { ...IDLE, games: games(14, 8, 14, 8) },
      });
    case "paused":
      // FIX-2 (round-2 #30): the kill switch skipped the last build (D-P6-FIX1-10): "Profile updates are paused", no Retry.
      return build({
        snapshot: snapshot(insufficientMetrics(14, 12, []), "INSUFFICIENT"),
        probe: { ...IDLE, paused: true, games: games(14, 12, 14, 12) },
      });
  }
}

/** The longest strings and largest counts the contract allows (TE X9). */
function stressed(p: WeaknessPayload): WeaknessPayload {
  const long = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : `${s}${" (stress)".repeat(10)}`.slice(0, n));
  const rows = (rs: WeaknessPayload["top"]) =>
    rs.map((r, i) => ({
      ...r,
      label: i === 0 ? "Missed 'remove the defender'" : long(r.label, 40),
      events: 100 + r.events,
      inBank: 100 + r.inBank,
      where: long(`${r.where.split(" · ")[0]} · 117 of the last 120 games`, 80),
    }));
  return {
    ...p,
    scopeLabel: long("999 games · rapid, blitz, bullet and classical · since Aug 2026", 80),
    scopeLabelShort: long("999 games · since Aug 2026", 60),
    games: { ...p.games, analysed: Math.max(p.games.analysed, 100) + 199, inScope: 999 },
    top: rows(p.top),
    more: rows(p.more),
    preliminary: p.preliminary.map((x) => ({ ...x, label: long(`${x.label} after long thinks`, 40), seenIn: 117, of: 199 })),
    breakdown: p.breakdown
      ? {
          ...p.breakdown,
          openings: p.breakdown.openings.map((o, i) =>
            i === 0 ? { ...o, family: "Sicilian Defense: Najdorf Variation, English Attack, Main Li", ecoRange: "B90–B99", games: 388 } : { ...o, games: 100 + o.games },
          ),
        }
      : null,
  };
}

/** One fixture: `lesson` resolves the P8 lesson slots, `stress` stretches every string and count. */
export function weaknessPayloadFixture(state: WeaknessFixtureState = "ready", opts: { lesson?: boolean; stress?: boolean } = {}): WeaknessPayload {
  let p = byState(state);
  if (opts.lesson) {
    const withLesson = (rs: WeaknessPayload["top"]) => rs.map((r) => ({ ...r, lesson: FIXTURE_LESSONS[r.pattern] ?? null }));
    const top = withLesson(p.top);
    const lesson = top[0]?.lesson;
    p = {
      ...p,
      top,
      more: withLesson(p.more),
      weekPlan: lesson && p.weekPlan.length > 0 ? [...p.weekPlan, { kind: "lesson", label: `Legend lesson: ${lesson.title}`, sub: lesson.sub, href: `/learn/lessons/${lesson.slug}?from=weakness` }] : p.weekPlan,
    };
  }
  return opts.stress ? stressed(p) : p;
}

/** Every state, plain. */
export function weaknessPayloadFixtures(): Record<WeaknessFixtureState, WeaknessPayload> {
  return Object.fromEntries(WEAKNESS_FIXTURE_STATES.map((s) => [s, weaknessPayloadFixture(s)])) as Record<WeaknessFixtureState, WeaknessPayload>;
}
