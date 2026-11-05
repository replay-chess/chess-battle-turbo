import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DB_NULL,
  countActions,
  fixtureSnapshot,
  isPendingLegend,
  isPendingTournament,
  mediaHosts,
  normalizeExport,
  planContent,
  planRetirePlaceholders,
  planTournamentFixtures,
  valuesEqual,
  type ContentPlan,
  type PlanRow,
  type SourceSnapshot,
  type TargetLegend,
  type TargetPosition,
  type TargetSnapshot,
} from "./seed-content-plan";

const EMPTY: TargetSnapshot = { legends: [], positions: [], openings: [] };

// Simulates what `--apply` writes and what the DB returns, so a second plan
// can be computed against it (jsonb drops key order; DB_NULL reads back as null).
function applyToTarget(plan: ContentPlan, target: TargetSnapshot): TargetSnapshot {
  let nextId = 1000n;
  const legendIds = new Map<string, bigint>();
  const read = (v: unknown) => (v === DB_NULL ? null : v);
  const legends: TargetLegend[] = target.legends.map((l) => ({ ...l }));
  for (const r of plan.legends) {
    if (r.action === "insert") {
      const id = nextId++;
      legendIds.set(r.key, id);
      const d = Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, read(v)]));
      legends.push({
        id,
        referenceId: (d.referenceId as string) ?? `cuid-${id}`,
        profilePhotoUrl: null,
        peakRating: null,
        nationality: null,
        playingStyle: null,
        birthYear: null,
        deathYear: null,
        achievements: null,
        famousGames: null,
        isActive: true,
        isVisible: false,
        ...d,
      } as TargetLegend);
    } else if (r.action === "update") {
      Object.assign(legends.find((l) => l.id === r.id)!, Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, read(v)])));
    }
  }
  const fk = (v: unknown) => (isPendingLegend(v) ? legendIds.get(v.pendingLegend)! : read(v));
  const positions: TargetPosition[] = target.positions.map((p) => ({ ...p }));
  for (const r of plan.positions) {
    const d = Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, k.endsWith("PlayerId") ? fk(v) : read(v)]));
    if (r.action === "insert") {
      const id = nextId++;
      positions.push({ ...blankPosition(id, d.fen as string), referenceId: (d.referenceId as string) ?? `cuid-${id}`, ...d } as TargetPosition);
    } else if (r.action === "update") {
      Object.assign(positions.find((p) => p.id === r.id)!, d);
    }
  }
  return { legends, positions, openings: target.openings };
}

function blankPosition(id: bigint, fen: string): TargetPosition {
  return {
    id,
    referenceId: `dev-ref-${id}`,
    fen,
    sideToMove: "white",
    pgn: null,
    moveNumber: null,
    whitePlayerName: null,
    blackPlayerName: null,
    whitePlayerMetadata: null,
    blackPlayerMetadata: null,
    whitePlayerId: null,
    blackPlayerId: null,
    tournamentName: null,
    eventDate: null,
    gameMetadata: null,
    positionType: null,
    positionContext: null,
    explanation: null,
    explanationAudioUrl: null,
    sourceType: "manual",
    sourceMetadata: null,
    popularityScore: null,
    featured: false,
    isActive: true,
  };
}

const actions = (rows: PlanRow[]) => rows.map((r) => r.action);

test("empty target: the fixtures plan is all inserts (6 legends, 5 positions)", () => {
  const plan = planContent(fixtureSnapshot(), EMPTY);
  assert.deepEqual(countActions(plan.legends), { insert: 6, update: 0, unchanged: 0, conflict: 0 });
  assert.deepEqual(countActions(plan.positions), { insert: 5, update: 0, unchanged: 0, conflict: 0 });
  assert.equal(plan.openings.length, 0);
  assert.deepEqual(plan.log, []);

  const mo = plan.positions.find((r) => r.key.startsWith("rn2kb1r"))!;
  assert.deepEqual(mo.data.whitePlayerId, { pendingLegend: "Paul Morphy" });
  assert.equal(mo.data.blackPlayerId, null);
  assert.equal(mo.data.blackPlayerName, "Duke Karl of Brunswick and Count Isouard");
  assert.equal(mo.data.moveNumber, 10);
  assert.equal(mo.data.sourceType, "design-fixture");
  assert.equal(mo.data.positionType, "legend");
  assert.deepEqual(mo.data.positionContext, { theme: "Attack" });
  assert.deepEqual(mo.data.gameMetadata, { datePrecision: "year" });
  assert.equal((mo.data.eventDate as Date).toISOString(), "1858-01-01T00:00:00.000Z");
  assert.equal(mo.data.featured, true);
  assert.equal(mo.data.isActive, true);
  assert.ok(!("referenceId" in mo.data), "fixtures let the DB generate referenceId");

  const kt = plan.positions.find((r) => r.key.startsWith("b2r3r"))!;
  assert.deepEqual(kt.data.blackPlayerId, { pendingLegend: "Veselin Topalov" });
  const bf = plan.positions.find((r) => r.key.startsWith("r3r1k1"))!;
  assert.equal(bf.data.whitePlayerId, null);
  assert.equal(bf.data.sideToMove, "black");

  const morphy = plan.legends.find((r) => r.key === "Paul Morphy")!;
  assert.equal(morphy.data.isVisible, true);
  assert.equal(morphy.data.isActive, true);
  assert.equal(morphy.data.deathYear, 1884);
  assert.equal(morphy.data.peakRating, null);
  assert.deepEqual(morphy.data.achievements, ["Won the First American Chess Congress, 1857"]);
  assert.equal((morphy.data.famousGames as unknown[]).length, 1);
  assert.ok(!("profilePhotoUrl" in morphy.data), "photo is left to the column default (null)");
});

test("the same snapshot twice: second plan is all unchanged", () => {
  const first = planContent(fixtureSnapshot(), EMPTY);
  const after = applyToTarget(first, EMPTY);
  const second = planContent(fixtureSnapshot(), after);
  assert.deepEqual(countActions(second.legends), { insert: 0, update: 0, unchanged: 6, conflict: 0 });
  assert.deepEqual(countActions(second.positions), { insert: 0, update: 0, unchanged: 5, conflict: 0 });
  // A third run is still unchanged.
  const third = planContent(fixtureSnapshot(), applyToTarget(second, after));
  assert.ok([...third.legends, ...third.positions].every((r) => r.action === "unchanged"));
});

test("jsonb key order and Date vs ISO string do not count as changes", () => {
  assert.equal(valuesEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), true);
  assert.equal(valuesEqual([1, 2], [2, 1]), false);
  assert.equal(valuesEqual(DB_NULL, null), true);
  assert.equal(valuesEqual(new Date("1858-01-01T00:00:00Z"), new Date(Date.UTC(1858, 0, 1))), true);
  assert.equal(valuesEqual(5n, 5n), true);
  assert.equal(valuesEqual(5n, 6n), false);
  assert.equal(valuesEqual({ a: 1 }, { a: 1, b: 2 }), false);
});

test("a content change on an existing row is an update of only the changed columns", () => {
  const after = applyToTarget(planContent(fixtureSnapshot(), EMPTY), EMPTY);
  const morphy = after.legends.find((l) => l.name === "Paul Morphy")!;
  morphy.playingStyle = "edited by hand";
  morphy.profilePhotoUrl = "https://media.example/morphy.jpg";
  const plan = planContent(fixtureSnapshot(), after);
  const row = plan.legends.find((r) => r.key === "Paul Morphy")!;
  assert.equal(row.action, "update");
  assert.deepEqual(row.changed, ["playingStyle"]);
  assert.deepEqual(row.data, { playingStyle: "Fast development and open lines" });
  assert.equal(row.id, morphy.id);
});

test("a FEN collision with a different referenceId is an update that keeps the dev referenceId", () => {
  const fen = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
  const target: TargetSnapshot = {
    legends: [],
    positions: [{ ...blankPosition(4n, fen), referenceId: "dev-ref-4", tournamentName: "Old label" }],
    openings: [],
  };
  const source: SourceSnapshot = {
    legends: [],
    positions: [{ referenceId: "prod-ref-xyz", fen, sideToMove: "white", tournamentName: "Paris Opera" }],
    openings: [],
  };
  const plan = planContent(source, target);
  assert.equal(plan.positions.length, 1);
  const row = plan.positions[0]!;
  assert.equal(row.action, "update");
  assert.equal(row.id, 4n);
  assert.deepEqual(row.data, { tournamentName: "Paris Opera" });
  assert.ok(!("referenceId" in row.data));
  assert.ok(!("timesPlayed" in row.data));
  assert.ok(plan.log.some((l) => l.includes("dev keeps dev-ref-4")));
});

test("a referenceId match whose new FEN belongs to another row is a conflict", () => {
  const target: TargetSnapshot = {
    legends: [],
    positions: [
      { ...blankPosition(1n, "fen-a w - - 0 1"), referenceId: "ref-1" },
      { ...blankPosition(2n, "fen-b w - - 0 1"), referenceId: "ref-2" },
    ],
    openings: [],
  };
  const plan = planContent(
    { legends: [], positions: [{ referenceId: "ref-1", fen: "fen-b w - - 0 1", sideToMove: "white" }], openings: [] },
    target,
  );
  assert.equal(plan.positions[0]!.action, "conflict");
  assert.equal(plan.positions[0]!.reason, "fen-taken");
});

test("a missing legend ref logs orphan-legend and sets the FK to null", () => {
  const plan = planContent(
    {
      legends: [{ referenceId: "leg-1", name: "Known Legend", era: "Modern Era", shortDescription: "x" }],
      positions: [
        {
          fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
          sideToMove: "white",
          whiteLegend: { referenceId: "leg-missing" },
          blackLegend: { referenceId: "leg-1" },
        },
      ],
      openings: [],
    },
    EMPTY,
  );
  const row = plan.positions[0]!;
  assert.equal(row.action, "insert");
  assert.equal(row.data.whitePlayerId, null);
  assert.deepEqual(row.data.blackPlayerId, { pendingLegend: "Known Legend" });
  assert.ok(plan.log.some((l) => l.startsWith("orphan-legend") && l.includes("leg-missing")));
});

test("a source legend ref maps through the name fallback to the dev row", () => {
  const target: TargetSnapshot = {
    legends: [
      {
        id: 7n,
        referenceId: "dev-legend-ref",
        name: "Paul Morphy",
        era: "Romantic Era",
        profilePhotoUrl: null,
        peakRating: null,
        nationality: "USA",
        shortDescription: "x",
        playingStyle: null,
        birthYear: 1837,
        deathYear: 1884,
        achievements: null,
        famousGames: null,
        isActive: true,
        isVisible: true,
      },
    ],
    positions: [],
    openings: [],
  };
  const plan = planContent(
    {
      legends: [{ referenceId: "prod-legend-ref", name: "Paul Morphy" }],
      positions: [{ fen: "8/8/8/8/8/8/8/K6k w - - 0 1", sideToMove: "white", whiteLegend: { referenceId: "prod-legend-ref" } }],
      openings: [],
    },
    target,
  );
  assert.equal(plan.legends[0]!.action, "unchanged");
  assert.ok(plan.log.some((l) => l.startsWith("conflict:renamed-ref")));
  assert.equal(plan.positions[0]!.data.whitePlayerId, 7n);
});

test("JSON null becomes DB_NULL, on both the planner and the export paths", () => {
  const { snapshot } = normalizeExport({
    legends: [{ name: "L", era: "Modern Era", shortDescription: "x", achievements: null, famousGames: [{ fen: "f" }], profilePhotoUrl: null }],
    positions: [{ fen: "8/8/8/8/8/8/8/K6k w - - 0 1", sideToMove: "white", explanation: null, pgn: null }],
    openings: [],
  });
  assert.equal(snapshot.legends[0]!.achievements, DB_NULL);
  assert.equal(snapshot.legends[0]!.profilePhotoUrl, null);
  assert.equal(snapshot.positions[0]!.explanation, DB_NULL);
  assert.equal(snapshot.positions[0]!.pgn, null);
  const plan = planContent(snapshot, EMPTY);
  assert.equal(plan.legends[0]!.data.achievements, DB_NULL);
  assert.equal(plan.positions[0]!.data.explanation, DB_NULL);
});

test("json path: sourceMetadata and unknown columns are dropped; legend refs and dates are read", () => {
  const { snapshot, droppedColumns } = normalizeExport({
    exportedAt: "2026-11-05T00:00:00Z",
    legends: [{ id: null, referenceId: "leg-1", name: "L", era: "E", shortDescription: "s", createdAt: "2026-01-02T03:04:05.000Z", secret: "x" }],
    positions: [
      {
        id: 99,
        referenceId: "pos-1",
        fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
        sideToMove: "white",
        sourceMetadata: { scrapedFrom: "somewhere", token: "abc" },
        whitePlayerId: 12,
        timesPlayed: 50,
        whiteLegendRef: "leg-1",
        blackLegendRef: null,
        eventDate: "1858-01-01T00:00:00.000Z",
        explanationAudioUrl: "https://pub-abc.r2.dev/audio/1.mp3",
      },
    ],
    openings: [{ eco: "C50", name: "Italian", pgn: "1. e4", explanation: { s: 1 } }],
    openingKeys: [["C50", "Italian", "1. e4"], ["A00", "Polish", "1. b4"]],
  });
  const p = snapshot.positions[0]!;
  assert.ok(!("sourceMetadata" in p));
  assert.ok(!("whitePlayerId" in p));
  assert.ok(!("timesPlayed" in p));
  assert.ok(!("id" in p));
  assert.deepEqual(p.whiteLegend, { referenceId: "leg-1" });
  assert.equal(p.blackLegend, null);
  assert.ok(p.eventDate instanceof Date);
  assert.ok(snapshot.legends[0]!.createdAt instanceof Date);
  assert.ok(droppedColumns.includes("chess_positions.sourceMetadata"));
  assert.ok(droppedColumns.includes("legends.secret"));
  assert.equal(snapshot.openings.length, 2);
  assert.deepEqual(snapshot.openings.find((o) => o.eco === "C50")!.explanation, { s: 1 });
  assert.deepEqual(mediaHosts(snapshot), { "position.explanationAudioUrl pub-abc.r2.dev": 1 });

  const plan = planContent(snapshot, EMPTY);
  const ins = plan.positions[0]!;
  assert.ok(!("sourceMetadata" in ins.data));
  assert.equal(ins.data.referenceId, "pos-1");
  assert.deepEqual(ins.data.whitePlayerId, { pendingLegend: "L" });
  assert.equal(ins.data.blackPlayerId, null);
});

test("export validation: NOT NULL columns and types", () => {
  assert.throws(() => normalizeExport({ legends: [{ name: null }] }), /legends.name is null/);
  assert.throws(() => normalizeExport({ legends: [{ name: 5 }] }), /not a string/);
  assert.throws(() => normalizeExport({ positions: [{ fen: "x", eventDate: "nope" }] }), /not a date/);
  assert.throws(() => normalizeExport({ legends: {} }), /not an array/);
  assert.throws(() => normalizeExport([]), /not an object/);
});

test("openings: match by (eco, name, pgn), content columns only; missing keys insert", () => {
  const target: TargetSnapshot = {
    legends: [],
    positions: [],
    openings: [
      { id: 1n, eco: "C50", name: "Italian", pgn: "1. e4", isActive: true, explanation: null, explanationAudioUrl: null },
      { id: 2n, eco: "B00", name: "Other", pgn: "1. e4 b6", isActive: true, explanation: null, explanationAudioUrl: null },
    ],
  };
  const plan = planContent(
    {
      legends: [],
      positions: [],
      openings: [
        { referenceId: "prod-ref", eco: "C50", name: "Italian", pgn: "1. e4", fen: "IGNORED", explanation: { s: 1 } },
        { eco: "B00", name: "Other", pgn: "1. e4 b6" },
        { eco: "A00", name: "Polish", pgn: "1. b4", fen: "f", sideToMove: "black", moveCount: 1 },
        { eco: "A01", name: "No fen", pgn: "1. b3" },
      ],
    },
    target,
  );
  assert.deepEqual(actions(plan.openings), ["update", "unchanged", "insert", "conflict"]);
  assert.deepEqual(plan.openings[0]!.data, { explanation: { s: 1 } });
  assert.equal(plan.openings[2]!.data.eco, "A00");
});

test("legends: insert needs era and shortDescription; duplicates in the source conflict", () => {
  const plan = planContent(
    {
      legends: [
        { name: "No era", shortDescription: "x" },
        { name: "Dup", era: "E", shortDescription: "x" },
        { name: "Dup", era: "E", shortDescription: "y" },
      ],
      positions: [],
      openings: [],
    },
    EMPTY,
  );
  assert.deepEqual(actions(plan.legends), ["conflict", "insert", "conflict"]);
});

test("--retire-placeholders deactivates only active 'Various' manual rows", () => {
  const rows = planRetirePlaceholders([
    { ...blankPosition(1n, "a"), whitePlayerName: "Various" },
    { ...blankPosition(2n, "b"), whitePlayerName: "Various", isActive: false },
    { ...blankPosition(3n, "c"), whitePlayerName: "Paul Morphy" },
    { ...blankPosition(4n, "d"), whitePlayerName: "Various", sourceType: "design-fixture" },
  ]);
  assert.deepEqual(actions(rows), ["update", "unchanged"]);
  assert.deepEqual(rows[0]!.data, { isActive: false });
});

test("--with-tournament-fixtures: 3 bot-owned tournaments, insert-only, participants by seed user", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const first = planTournamentFixtures(
    { ownerId: 1n, participantIds: [3n, 4n, 5n, 6n, 7n], tournaments: [], participants: [] },
    now,
  );
  assert.deepEqual(countActions(first.tournaments), { insert: 3, update: 0, unchanged: 0, conflict: 0 });
  assert.equal(first.participants.length, 15);
  assert.ok(first.participants.every((p) => isPendingTournament(p.data.tournamentId)));
  assert.deepEqual(
    first.tournaments.map((t) => t.data.status),
    ["LOBBY", "ACTIVE", "COMPLETED"],
  );
  assert.ok(first.tournaments.every((t) => t.data.createdByUserId === 1n && t.data.mode === "FREE"));

  const second = planTournamentFixtures(
    {
      ownerId: 1n,
      participantIds: [3n, 4n, 5n, 6n, 7n],
      tournaments: first.tournaments.map((t, i) => ({ id: BigInt(100 + i), name: t.key, createdByUserId: 1n })),
      participants: [100n, 101n, 102n].flatMap((tid) => [3n, 4n, 5n, 6n, 7n].map((uid) => ({ tournamentId: tid, userId: uid }))),
    },
    now,
  );
  assert.ok([...second.tournaments, ...second.participants].every((r) => r.action === "unchanged"));

  const noOwner = planTournamentFixtures({ ownerId: null, participantIds: [], tournaments: [], participants: [] }, now);
  assert.equal(noOwner.tournaments[0]!.action, "conflict");
  const missingUser = planTournamentFixtures({ ownerId: 1n, participantIds: [3n, null, 5n, 6n, 7n], tournaments: [], participants: [] }, now);
  assert.equal(countActions(missingUser.participants).conflict, 3);
});
