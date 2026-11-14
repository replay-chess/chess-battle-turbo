// The Mistake Bank statements of one extraction (phase-05 plan §7.6 "J1 batch statements", §8.1 step 8; AP-27).
//
// They ride in ONE non-interactive batch: P3's final analysis batch (final-batch/p05-bank.ts) or the EXTRACT_MISTAKES
// job's own batch (jobs/extract-mistakes.ts). No statement reads another's RETURNING: every one joins back on natural
// keys (`("userId","epdHash")`, `("gameId", ply)`, `("userId","itemKey")`), and later statements see earlier ones' rows
// because the batch is one transaction. `$m`, `$o`, `$c`, `$days` are JSON arrays built in TS (bigints as decimal
// strings, instants as UTC `timestamp(3)` text); `NOW` is the job clock of the queue statements (claim.ts).
//
//  L  the game's review rows FOR UPDATE, first: A6 (the moment's bank switch) updates the same row, so an opt-out and
//     this batch's cards never interleave (A6 commits first → statement 4 reads the opt-out; this batch first → A6
//     waits, then re-reads the link and removes the card; FIX-1 A6 race). J1 already holds it (P3 wrote the review).
//   0  best move changed (a newer engine): reset the card to NEW, due at the next release, BEFORE 1 overwrites the
//      stored solution (old vs new first move compared in SQL)
//   1  mistakes: insert, or refresh the "last seen" fields (an older game never overwrites a newer occurrence)
//   2  occurrences: insert (idempotent on re-analysis); a NEW occurrence of any candidate ply (an error the member made
//      again in a newer game, key moment or not: plan §8.1 step 8, FIX-1) whose mistake already has a card is a
//      recurrence: the card comes back at the next release at the latest (no FSRS log row), unless the member reviewed
//      it after this game ended
//   3  the occurrence count, by natural key
//   4  cards for key-moment plies: not for hidden mistakes, not for the member's opt-outs (PlayerReview.progress
//      .bankOptOut, read in SQL), ON CONFLICT DO NOTHING; `theme_mastery."bankCount"` += the inserted cards per theme
//   5  game_players."bankVersion" = EXTRACT_VERSION for the extracted member sides
//   6  per member: due counts (review / new), today's cap counters, the BANK total (bankDue is the §8.5 cap formula in TS)
//   7  per member: the moment plies of this game that have a card now (`bankAdded`, A2's rule)
//
// Every statement is idempotent: re-running the batch (a retry, a re-analysis, a second EXTRACT_MISTAKES) inserts no
// second row, counts nothing twice and moves no due date earlier than the first run did. The recurrence rule (2) needs
// the occurrence to be new in this batch, so a re-analysis of the same game is not a recurrence.
import { stmt, type Statement } from "../db/client";
import { NOW } from "../queue/claim";

/** One `mistakes` row (§6.2), as `$m`. */
export interface MistakeRow {
  referenceId: string;
  userId: string;
  epdHash: string;
  color: "w" | "b";
  fen: string;
  setupUci: string | null;
  solution: string;
  accept: string | null;
  playedUci: string;
  refuteUci: string | null;
  judgement: string;
  source: "OWN_ERROR" | "MISSED_PUNISH";
  isPuzzle: boolean;
  uniquenessGap: number | null;
  themes: string[];
  primaryTheme: string;
  phase: "OPENING" | "MIDDLEGAME" | "ENDGAME";
  winBefore: number;
  winAfterPlayed: number;
  cpBest: number | null;
  mateBest: number | null;
  timeClass: string | null;
  ecoCode: string | null;
  moveNumber: number;
  lastGameId: string;
  lastPly: number;
  lastPlayedAt: string;
  lastOpponentName: string;
  /** When a changed best move resets the card (statement 0): the next release. */
  due: string;
}

/** One `mistake_occurrences` row (+ what the recurrence rule needs), as `$o`. */
export interface OccurrenceRow {
  userId: string;
  epdHash: string;
  gameId: string;
  ply: number;
  /** The game side's end time: a card reviewed after it is not pulled forward. */
  playedAt: string;
  /** The next release in the member's zone. */
  due: string;
  /** A key-moment ply (it gets a card). Every new occurrence of a carded mistake is a recurrence, moment or not. */
  moment: boolean;
}

/** One BANK card to create for a key-moment ply, as `$c`. */
export interface CardRow {
  userId: string;
  epdHash: string;
  gameId: string;
  color: "w" | "b";
  ply: number;
  kind: "MISTAKE" | "REVIEW_POSITION";
  itemKey: string;
  due: string;
}

/** Each member's local training day (for today's cap counters), as `$days`. */
export interface DayRow {
  userId: string;
  day: string;
}

export interface BankRows {
  gameId: string;
  mistakes: readonly MistakeRow[];
  occurrences: readonly OccurrenceRow[];
  cards: readonly CardRow[];
  days: readonly DayRow[];
  /** The member sides extracted (bankVersion). */
  userIds: readonly string[];
  /** Every key-moment ply of the extracted sides. */
  momentPlies: readonly number[];
  version: number;
}

const json = (rows: readonly object[]) => JSON.stringify(rows);

/** Statement L: the game's review rows, locked before any card statement (the A6 switch updates them). */
export function lockReviewsStatement(r: BankRows): Statement {
  return stmt(`SELECT count(*)::int AS locked FROM (SELECT 1 FROM player_reviews WHERE "gameId" = $1::bigint FOR UPDATE) l`, [r.gameId]);
}

/** Statement 0: reset a card whose stored solution starts with another move (before 1 overwrites it). */
export function resetChangedBestStatement(r: BankRows): Statement {
  return stmt(
    `UPDATE training_cards c
    SET state = 'NEW', reps = 0, lapses = 0, stability = 0, difficulty = 0, "elapsedDays" = 0, "scheduledDays" = 0,
        "learningSteps" = 0, mastery = 0, "lastReview" = NULL, due = x.due, "updatedAt" = ${NOW}
   FROM mistakes m, jsonb_to_recordset($1::jsonb) AS x("userId" bigint, "epdHash" bigint, solution text,
                                                         "lastPlayedAt" timestamp(3), due timestamp(3))
  WHERE m."userId" = x."userId" AND m."epdHash" = x."epdHash" AND c."mistakeId" = m.id
    AND split_part(m.solution, ' ', 1) <> split_part(x.solution, ' ', 1) AND x."lastPlayedAt" >= m."lastPlayedAt"`,
    [json(r.mistakes)],
  );
}

/** Statement 1: insert or refresh (the newest occurrence's `last*` fields win). */
export function upsertMistakesStatement(r: BankRows): Statement {
  return stmt(
    `INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, "setupUci", solution, accept, "playedUci",
                       "refuteUci", judgement, source, "isPuzzle", "uniquenessGap", themes, "primaryTheme", phase,
                       "winBefore", "winAfterPlayed", "cpBest", "mateBest", "timeClass", "ecoCode", "moveNumber",
                       "lastGameId", "lastPly", "lastPlayedAt", "lastOpponentName", "createdAt", "updatedAt")
SELECT x."referenceId", x."userId", x."epdHash", x.color, x.fen, x."setupUci", x.solution, x.accept, x."playedUci",
       x."refuteUci", x.judgement::"Judgement", x.source::"MistakeSource", x."isPuzzle", x."uniquenessGap",
       ARRAY(SELECT jsonb_array_elements_text(x.themes)), x."primaryTheme", x.phase::"GamePhase", x."winBefore",
       x."winAfterPlayed", x."cpBest", x."mateBest", x."timeClass"::"TimeClass", x."ecoCode", x."moveNumber",
       x."lastGameId", x."lastPly", x."lastPlayedAt", x."lastOpponentName", ${NOW}, ${NOW}
  FROM jsonb_to_recordset($1::jsonb) AS x("referenceId" text, "userId" bigint, "epdHash" bigint, color text, fen text,
       "setupUci" text, solution text, accept text, "playedUci" text, "refuteUci" text, judgement text, source text,
       "isPuzzle" boolean, "uniquenessGap" real, themes jsonb, "primaryTheme" text, phase text, "winBefore" real,
       "winAfterPlayed" real, "cpBest" int, "mateBest" smallint, "timeClass" text, "ecoCode" text, "moveNumber" smallint,
       "lastGameId" bigint, "lastPly" smallint, "lastPlayedAt" timestamp(3), "lastOpponentName" text)
ON CONFLICT ("userId", "epdHash") DO UPDATE
   SET "lastGameId" = EXCLUDED."lastGameId", "lastPly" = EXCLUDED."lastPly", "lastPlayedAt" = EXCLUDED."lastPlayedAt",
       "lastOpponentName" = EXCLUDED."lastOpponentName", solution = EXCLUDED.solution, accept = EXCLUDED.accept,
       "isPuzzle" = EXCLUDED."isPuzzle", "uniquenessGap" = EXCLUDED."uniquenessGap", themes = EXCLUDED.themes,
       "primaryTheme" = EXCLUDED."primaryTheme", "updatedAt" = EXCLUDED."updatedAt"
 WHERE EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt"
RETURNING "userId"::text AS "userId", (xmax = 0) AS inserted`,
    [json(r.mistakes)],
  );
}

/** Statement 2: occurrences (idempotent) + the recurrence rule on NEW occurrences of key-moment plies. */
export function occurrencesStatement(r: BankRows): Statement {
  return stmt(
    `WITH x AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x("userId" bigint, "epdHash" bigint, "gameId" bigint, ply int,
                                                   "playedAt" timestamp(3), due timestamp(3), moment boolean)
), ins AS (
  INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId")
  SELECT x."gameId", x.ply, m.id FROM x JOIN mistakes m ON m."userId" = x."userId" AND m."epdHash" = x."epdHash"
  ON CONFLICT DO NOTHING
  RETURNING "gameId", ply, "mistakeId"
), rec AS (
  UPDATE training_cards c SET due = LEAST(c.due, x.due), "updatedAt" = ${NOW}
    FROM ins JOIN x ON x."gameId" = ins."gameId" AND x.ply = ins.ply
   WHERE c."mistakeId" = ins."mistakeId" AND c.deck = 'BANK' AND c.due > x.due
     AND (c."lastReview" IS NULL OR c."lastReview" <= x."playedAt")
  RETURNING c."userId"
)
SELECT u."userId"::text AS "userId",
       (SELECT count(*) FROM ins JOIN mistakes m ON m.id = ins."mistakeId" WHERE m."userId" = u."userId")::int AS occurrences,
       (SELECT count(*) FROM rec WHERE rec."userId" = u."userId")::int AS recurrences
  FROM (SELECT DISTINCT "userId" FROM x) u`,
    [json(r.occurrences)],
  );
}

/** Statement 3: `occurrences` = the occurrence count of every mistake this batch touched. */
export function recountStatement(r: BankRows): Statement {
  return stmt(
    `UPDATE mistakes m SET occurrences = s.n
   FROM (SELECT o."mistakeId", count(*)::smallint AS n
           FROM mistake_occurrences o
           JOIN mistakes mm ON mm.id = o."mistakeId"
           JOIN (SELECT DISTINCT "userId", "epdHash"
                   FROM jsonb_to_recordset($1::jsonb) AS x("userId" bigint, "epdHash" bigint)) x
             ON mm."userId" = x."userId" AND mm."epdHash" = x."epdHash"
          GROUP BY o."mistakeId") s
  WHERE m.id = s."mistakeId" AND m.occurrences IS DISTINCT FROM s.n`,
    [json(r.occurrences)],
  );
}

/** Statement 4: the BANK cards of key-moment plies, and `theme_mastery."bankCount"` for the inserted ones. */
export function cardsStatement(r: BankRows): Statement {
  return stmt(
    `WITH ins AS (
  INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt",
                              "updatedAt")
  SELECT m."userId", 'BANK', x.kind::"TrainingItemKind", x."itemKey", m.id, m."primaryTheme", m.phase, x.due, 'NEW',
         ${NOW}, ${NOW}
    FROM jsonb_to_recordset($1::jsonb) AS x("userId" bigint, "epdHash" bigint, "gameId" bigint, color text, ply int,
                                            kind text, "itemKey" text, due timestamp(3))
    JOIN mistakes m ON m."userId" = x."userId" AND m."epdHash" = x."epdHash" AND m."hiddenAt" IS NULL
    LEFT JOIN player_reviews pr ON pr."gameId" = x."gameId" AND pr.color = x.color
   WHERE NOT (COALESCE(pr.progress -> 'bankOptOut', '[]'::jsonb) @> to_jsonb(x.ply))
  ON CONFLICT ("userId", "itemKey") DO NOTHING
  RETURNING "userId", theme
), tm AS (
  INSERT INTO theme_mastery ("userId", theme, "bankCount")
  SELECT "userId", theme, count(*)::smallint FROM ins GROUP BY 1, 2
  ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount" + EXCLUDED."bankCount"
  RETURNING 1
)
SELECT "userId"::text AS "userId", count(*)::int AS "cardsAdded", (SELECT count(*) FROM tm)::int AS themes
  FROM ins GROUP BY "userId"`,
    [json(r.cards)],
  );
}

/** Statement 5: the extraction marker. */
export function bankVersionStatement(r: BankRows): Statement {
  return stmt(
    `UPDATE game_players SET "bankVersion" = $3::smallint
  WHERE "gameId" = $1::bigint AND "userId" = ANY($2::bigint[]) AND "bankVersion" IS DISTINCT FROM $3::smallint`,
    [r.gameId, [...r.userIds], r.version],
  );
}

/** Statement 6: per member, the raw due counts, today's cap counters and the BANK total. */
export function dueCountsStatement(r: BankRows): Statement {
  return stmt(
    `SELECT x."userId"::text AS "userId",
       (SELECT count(*) FILTER (WHERE c.state <> 'NEW')::int FROM training_cards c
         WHERE c."userId" = x."userId" AND c.deck = 'BANK' AND c.due <= ${NOW}
           AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${NOW})) AS "dueReview",
       (SELECT count(*) FILTER (WHERE c.state = 'NEW')::int FROM training_cards c
         WHERE c."userId" = x."userId" AND c.deck = 'BANK' AND c.due <= ${NOW}
           AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= ${NOW})) AS "dueNew",
       (SELECT count(*)::int FROM training_cards c WHERE c."userId" = x."userId" AND c.deck = 'BANK') AS total,
       COALESCE(d."bankReviewed", 0)::int AS "bankReviewed", COALESCE(d."newIntroduced", 0)::int AS "newIntroduced"
  FROM jsonb_to_recordset($1::jsonb) AS x("userId" bigint, day date)
  LEFT JOIN training_days d ON d."userId" = x."userId" AND d.day = x.day`,
    [json(r.days)],
  );
}

/** Statement 7: per member, the moment plies of this game that have a BANK card now. */
export function bankAddedStatement(r: BankRows): Statement {
  return stmt(
    `SELECT m."userId"::text AS "userId", array_agg(mo.ply ORDER BY mo.ply)::int[] AS plies
  FROM mistake_occurrences mo
  JOIN mistakes m ON m.id = mo."mistakeId" AND m."hiddenAt" IS NULL
  JOIN training_cards c ON c."mistakeId" = m.id AND c.deck = 'BANK'
 WHERE mo."gameId" = $1::bigint AND mo.ply = ANY($2::int[]) AND m."userId" = ANY($3::bigint[])
 GROUP BY m."userId"`,
    [r.gameId, [...r.momentPlies], [...r.userIds]],
  );
}

/** The statements of one extraction, in order (§7.6). Empty when no member side was extracted. */
export function bankStatements(r: BankRows): Statement[] {
  if (r.userIds.length === 0) return [];
  const out: Statement[] = [lockReviewsStatement(r)];
  if (r.mistakes.length > 0) {
    out.push(resetChangedBestStatement(r), upsertMistakesStatement(r), occurrencesStatement(r), recountStatement(r));
  }
  if (r.cards.length > 0) out.push(cardsStatement(r));
  out.push(bankVersionStatement(r), dueCountsStatement(r), bankAddedStatement(r));
  return out;
}

/** Which statement of `bankStatements(r)` produced which rows. */
export interface BankStatementRows {
  mistakes: readonly Record<string, unknown>[];
  occurrences: readonly Record<string, unknown>[];
  cards: readonly Record<string, unknown>[];
  due: readonly Record<string, unknown>[];
  added: readonly Record<string, unknown>[];
}

/** Splits the rows of `bankStatements(r)` back into their statements (same order rules). */
export function splitBankRows(r: BankRows, rows: readonly (readonly Record<string, unknown>[])[]): BankStatementRows {
  let at = 0;
  const next = () => rows[at++] ?? [];
  const out: BankStatementRows = { mistakes: [], occurrences: [], cards: [], due: [], added: [] };
  if (r.userIds.length === 0) return out;
  next(); // L review lock
  if (r.mistakes.length > 0) {
    next(); // 0 reset
    out.mistakes = next();
    out.occurrences = next();
    next(); // 3 recount
  }
  if (r.cards.length > 0) out.cards = next();
  next(); // 5 bankVersion
  out.due = next();
  out.added = next();
  return out;
}
