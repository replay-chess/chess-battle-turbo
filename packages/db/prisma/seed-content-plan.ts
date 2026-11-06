// Pure planner for the dev-DB content seed (SPEC §11.2, 05 §4.3).
//
// Given a source snapshot (design fixtures, a JSON export, or an old-prod read)
// and the target's current rows, it returns per-table plan rows of
// { action: "insert" | "update" | "unchanged" | "conflict", key, data }.
// The CLI (`seed-content.ts`) executes them. This module must not import the
// generated Prisma client, so `test:unit` runs without `prisma generate`.
//
// Field convention for source rows: `undefined` = "not managed by this source"
// (never compared, never written; an insert falls back to the column default);
// `null` = SQL NULL. JSON columns use the DB_NULL sentinel for SQL NULL, which
// the CLI maps to `Prisma.DbNull`.
//
// Updates never touch `id`, `referenceId` or `timesPlayed`. Nothing is deleted.

import {
  DESIGN_FIXTURE_SOURCE_TYPE,
  FIXTURE_LEGENDS,
  FIXTURE_POSITIONS,
  famousGamesFor,
  moveNumberFromFen,
} from "./fixtures/design-legend-positions";

// ---------------------------------------------------------------------------
// Types

export const DB_NULL = Symbol("DbNull");
export type DbNull = typeof DB_NULL;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** A JSON column value in a source row: DB_NULL stands for SQL NULL. */
export type JsonCol = JsonValue | DbNull;

export type Action = "insert" | "update" | "unchanged" | "conflict";
export type SourceKind = "fixtures" | "json" | "db";

/** How a source position names a legend. Matched by referenceId first, then name. */
export interface LegendRef {
  referenceId?: string | null;
  name?: string | null;
}

export interface SourceLegend {
  referenceId?: string;
  name: string;
  era?: string;
  profilePhotoUrl?: string | null;
  peakRating?: number | null;
  nationality?: string | null;
  shortDescription?: string;
  playingStyle?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  achievements?: JsonCol;
  famousGames?: JsonCol;
  isActive?: boolean;
  isVisible?: boolean;
  createdAt?: Date;
}

export interface SourcePosition {
  referenceId?: string;
  fen: string;
  sideToMove?: string;
  pgn?: string | null;
  moveNumber?: number | null;
  whitePlayerName?: string | null;
  blackPlayerName?: string | null;
  whitePlayerMetadata?: JsonCol;
  blackPlayerMetadata?: JsonCol;
  /** undefined = FK not managed; null = no legend. */
  whiteLegend?: LegendRef | null;
  blackLegend?: LegendRef | null;
  tournamentName?: string | null;
  eventDate?: Date | null;
  gameMetadata?: JsonCol;
  positionType?: string | null;
  positionContext?: JsonCol;
  explanation?: JsonCol;
  explanationAudioUrl?: string | null;
  sourceType?: string;
  sourceMetadata?: JsonCol;
  popularityScore?: number | null;
  featured?: boolean;
  isActive?: boolean;
  createdAt?: Date;
}

export interface SourceOpening {
  referenceId?: string;
  eco: string;
  name: string;
  pgn: string;
  fen?: string;
  sideToMove?: string;
  moveCount?: number;
  isActive?: boolean;
  explanation?: JsonCol;
  explanationAudioUrl?: string | null;
  createdAt?: Date;
}

export interface SourceSnapshot {
  legends: SourceLegend[];
  positions: SourcePosition[];
  openings: SourceOpening[];
}

export interface TargetLegend {
  id: bigint;
  referenceId: string;
  name: string;
  era: string;
  profilePhotoUrl: string | null;
  peakRating: number | null;
  nationality: string | null;
  shortDescription: string;
  playingStyle: string | null;
  birthYear: number | null;
  deathYear: number | null;
  achievements: JsonValue;
  famousGames: JsonValue;
  isActive: boolean;
  isVisible: boolean;
}

export interface TargetPosition {
  id: bigint;
  referenceId: string;
  fen: string;
  sideToMove: string;
  pgn: string | null;
  moveNumber: number | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  whitePlayerMetadata: JsonValue;
  blackPlayerMetadata: JsonValue;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  tournamentName: string | null;
  eventDate: Date | null;
  gameMetadata: JsonValue;
  positionType: string | null;
  positionContext: JsonValue;
  explanation: JsonValue;
  explanationAudioUrl: string | null;
  sourceType: string;
  sourceMetadata: JsonValue;
  popularityScore: number | null;
  featured: boolean;
  isActive: boolean;
}

export interface TargetOpening {
  id: bigint;
  eco: string;
  name: string;
  pgn: string;
  isActive: boolean;
  explanation: JsonValue;
  explanationAudioUrl: string | null;
}

export interface TargetSnapshot {
  legends: TargetLegend[];
  positions: TargetPosition[];
  openings: TargetOpening[];
}

/** A legend FK whose legend is inserted by this same plan; the CLI swaps in the new id. */
export interface PendingLegend {
  pendingLegend: string;
}
export type LegendFk = bigint | null | PendingLegend;

export interface PlanRow {
  action: Action;
  /** Natural key, for logs: legend name, position FEN, `eco|name|pgn`, … */
  key: string;
  /** Target row id for update / unchanged. */
  id?: bigint;
  /** insert: the full row; update: only the changed columns; otherwise {}. */
  data: Record<string, unknown>;
  changed?: string[];
  reason?: string;
}

export interface ContentPlan {
  legends: PlanRow[];
  positions: PlanRow[];
  openings: PlanRow[];
  log: string[];
}

// ---------------------------------------------------------------------------
// Value comparison

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Equality for column values. DB_NULL equals null. JSON objects compare
 * key-order-insensitively (jsonb reorders keys); arrays compare in order.
 * Dates compare by instant; bigints by value.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = a === DB_NULL || a === undefined ? null : a;
  const nb = b === DB_NULL || b === undefined ? null : b;
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (na instanceof Date || nb instanceof Date) {
    const ta = na instanceof Date ? na.getTime() : typeof na === "string" ? Date.parse(na) : NaN;
    const tb = nb instanceof Date ? nb.getTime() : typeof nb === "string" ? Date.parse(nb) : NaN;
    return !Number.isNaN(ta) && ta === tb;
  }
  if (typeof na === "bigint" || typeof nb === "bigint") {
    try {
      return BigInt(na as bigint) === BigInt(nb as bigint);
    } catch {
      return false;
    }
  }
  if (Array.isArray(na) || Array.isArray(nb)) {
    if (!Array.isArray(na) || !Array.isArray(nb) || na.length !== nb.length) return false;
    return na.every((x, i) => valuesEqual(x, nb[i]));
  }
  if (isPlainObject(na) && isPlainObject(nb)) {
    const ka = Object.keys(na).filter((k) => na[k] !== undefined);
    const kb = Object.keys(nb).filter((k) => nb[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(nb, k) && valuesEqual(na[k], nb[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Column lists (managed content columns; never id / referenceId / timesPlayed)

export const LEGEND_CONTENT_FIELDS = [
  "name",
  "era",
  "profilePhotoUrl",
  "peakRating",
  "nationality",
  "shortDescription",
  "playingStyle",
  "birthYear",
  "deathYear",
  "achievements",
  "famousGames",
  "isActive",
  "isVisible",
] as const;

export const POSITION_CONTENT_FIELDS = [
  "fen",
  "sideToMove",
  "pgn",
  "moveNumber",
  "whitePlayerName",
  "blackPlayerName",
  "whitePlayerMetadata",
  "blackPlayerMetadata",
  "tournamentName",
  "eventDate",
  "gameMetadata",
  "positionType",
  "positionContext",
  "explanation",
  "explanationAudioUrl",
  "sourceType",
  "sourceMetadata",
  "popularityScore",
  "featured",
  "isActive",
] as const;

export const OPENING_CONTENT_FIELDS = ["isActive", "explanation", "explanationAudioUrl"] as const;

function pickDefined(row: object, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const r = row as Record<string, unknown>;
  for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
  return out;
}

function diff(desired: Record<string, unknown>, current: object): { data: Record<string, unknown>; changed: string[] } {
  const cur = current as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [k, v] of Object.entries(desired)) {
    if (!valuesEqual(v, cur[k])) {
      data[k] = v;
      changed.push(k);
    }
  }
  return { data, changed };
}

// ---------------------------------------------------------------------------
// Legends

type LegendResolution = { kind: "id"; id: bigint } | { kind: "pending"; key: string };

interface LegendIndex {
  byRef: Map<string, LegendResolution>;
  byName: Map<string, LegendResolution>;
}

function planLegends(source: SourceLegend[], target: TargetLegend[], log: string[]) {
  const tByRef = new Map(target.map((t) => [t.referenceId, t]));
  const tByName = new Map(target.map((t) => [t.name, t]));
  const rows: PlanRow[] = [];
  const index: LegendIndex = { byRef: new Map(), byName: new Map() };
  for (const t of target) {
    index.byRef.set(t.referenceId, { kind: "id", id: t.id });
    index.byName.set(t.name, { kind: "id", id: t.id });
  }
  const seenNames = new Set<string>();
  const seenRefs = new Set<string>();

  for (const s of source) {
    const key = s.name;
    if (seenNames.has(s.name) || (s.referenceId && seenRefs.has(s.referenceId))) {
      rows.push({ action: "conflict", key, data: {}, reason: "duplicate-in-source" });
      log.push(`conflict:duplicate-in-source legend "${key}"`);
      continue;
    }
    seenNames.add(s.name);
    if (s.referenceId) seenRefs.add(s.referenceId);

    const byRef = s.referenceId ? tByRef.get(s.referenceId) : undefined;
    const match = byRef ?? tByName.get(s.name);
    const desired = pickDefined(s, LEGEND_CONTENT_FIELDS);

    if (!match) {
      const missing = (["era", "shortDescription"] as const).filter((f) => s[f] === undefined);
      if (missing.length > 0) {
        rows.push({ action: "conflict", key, data: {}, reason: `missing-required:${missing.join(",")}` });
        log.push(`conflict:missing-required legend "${key}" has no ${missing.join(", ")}`);
        continue;
      }
      const data: Record<string, unknown> = { ...desired };
      if (s.referenceId) data.referenceId = s.referenceId;
      if (s.createdAt) data.createdAt = s.createdAt;
      rows.push({ action: "insert", key, data });
      const res: LegendResolution = { kind: "pending", key };
      if (s.referenceId) index.byRef.set(s.referenceId, res);
      index.byName.set(s.name, res);
      continue;
    }

    if (byRef && byRef.name !== s.name) {
      const other = tByName.get(s.name);
      if (other && other.id !== byRef.id) {
        rows.push({ action: "conflict", key, id: byRef.id, data: {}, reason: "name-taken" });
        log.push(`conflict:name-taken legend ref ${s.referenceId} renames to "${s.name}", held by id ${other.id}`);
        continue;
      }
    }
    if (!byRef && s.referenceId && s.referenceId !== match.referenceId) {
      log.push(`conflict:renamed-ref legend "${s.name}": source ref ${s.referenceId}, dev keeps ${match.referenceId}`);
    }
    // Map the source ref to the dev row too, so source positions remap through it.
    if (s.referenceId) index.byRef.set(s.referenceId, { kind: "id", id: match.id });
    index.byName.set(s.name, { kind: "id", id: match.id });

    const { data, changed } = diff(desired, match);
    rows.push(
      changed.length === 0
        ? { action: "unchanged", key, id: match.id, data: {} }
        : { action: "update", key, id: match.id, data, changed },
    );
  }
  return { rows, index };
}

function resolveLegend(ref: LegendRef, index: LegendIndex): LegendResolution | undefined {
  if (ref.referenceId) {
    const r = index.byRef.get(ref.referenceId);
    if (r) return r;
  }
  if (ref.name) return index.byName.get(ref.name);
  return undefined;
}

function fkValue(r: LegendResolution): LegendFk {
  return r.kind === "id" ? r.id : { pendingLegend: r.key };
}

function fkEqual(desired: LegendFk, current: bigint | null): boolean {
  if (desired === null || typeof desired === "bigint") return desired === current;
  return false; // pending insert: always a change
}

export function isPendingLegend(v: unknown): v is PendingLegend {
  return isPlainObject(v) && typeof v.pendingLegend === "string";
}

// ---------------------------------------------------------------------------
// Positions

function shortFen(fen: string): string {
  return fen.split(" ").slice(0, 2).join(" ");
}

function planPositions(source: SourcePosition[], target: TargetPosition[], index: LegendIndex, log: string[]) {
  const tByRef = new Map(target.map((t) => [t.referenceId, t]));
  const tByFen = new Map(target.map((t) => [t.fen, t]));
  const rows: PlanRow[] = [];
  const seenFens = new Set<string>();

  for (const s of source) {
    const key = s.fen;
    if (seenFens.has(s.fen)) {
      rows.push({ action: "conflict", key, data: {}, reason: "duplicate-in-source" });
      log.push(`conflict:duplicate-in-source position ${shortFen(key)}`);
      continue;
    }
    seenFens.add(s.fen);

    const desired = pickDefined(s, POSITION_CONTENT_FIELDS);
    const fks: Record<string, LegendFk> = {};
    for (const side of ["white", "black"] as const) {
      const ref = s[`${side}Legend`];
      if (ref === undefined) continue;
      const col = `${side}PlayerId`;
      if (ref === null || (!ref.referenceId && !ref.name)) {
        fks[col] = null;
        continue;
      }
      const r = resolveLegend(ref, index);
      if (!r) {
        fks[col] = null;
        log.push(
          `orphan-legend position ${shortFen(key)} ${side}: legend ${ref.referenceId ?? ref.name} not found; FK set to null`,
        );
      } else {
        fks[col] = fkValue(r);
      }
    }

    const byRef = s.referenceId ? tByRef.get(s.referenceId) : undefined;
    const match = byRef ?? tByFen.get(s.fen);

    if (!match) {
      if (s.sideToMove === undefined) {
        rows.push({ action: "conflict", key, data: {}, reason: "missing-required:sideToMove" });
        log.push(`conflict:missing-required position ${shortFen(key)} has no sideToMove`);
        continue;
      }
      const data: Record<string, unknown> = { ...desired, ...fks };
      if (s.referenceId) data.referenceId = s.referenceId;
      if (s.createdAt) data.createdAt = s.createdAt;
      rows.push({ action: "insert", key, data });
      continue;
    }

    if (byRef && byRef.fen !== s.fen) {
      const other = tByFen.get(s.fen);
      if (other && other.id !== byRef.id) {
        rows.push({ action: "conflict", key, id: byRef.id, data: {}, reason: "fen-taken" });
        log.push(`conflict:fen-taken position ref ${s.referenceId} moves to a FEN held by id ${other.id}`);
        continue;
      }
    }
    if (!byRef && s.referenceId && s.referenceId !== match.referenceId) {
      log.push(`fen-match position ${shortFen(key)}: source ref ${s.referenceId}, dev keeps ${match.referenceId}`);
    }

    const { data, changed } = diff(desired, match);
    for (const [col, v] of Object.entries(fks)) {
      if (!fkEqual(v, match[col as "whitePlayerId" | "blackPlayerId"])) {
        data[col] = v;
        changed.push(col);
      }
    }
    rows.push(
      changed.length === 0
        ? { action: "unchanged", key, id: match.id, data: {} }
        : { action: "update", key, id: match.id, data, changed },
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Openings (content columns only on existing rows; full row for missing keys)

export function openingKey(o: { eco: string; name: string; pgn: string }): string {
  return `${o.eco}|${o.name}|${o.pgn}`;
}

function planOpenings(source: SourceOpening[], target: TargetOpening[], log: string[]) {
  const tByKey = new Map(target.map((t) => [openingKey(t), t]));
  const rows: PlanRow[] = [];
  const seen = new Set<string>();
  for (const s of source) {
    const key = openingKey(s);
    if (seen.has(key)) {
      rows.push({ action: "conflict", key, data: {}, reason: "duplicate-in-source" });
      log.push(`conflict:duplicate-in-source opening ${key}`);
      continue;
    }
    seen.add(key);
    const desired = pickDefined(s, OPENING_CONTENT_FIELDS);
    const match = tByKey.get(key);
    if (!match) {
      if (s.fen === undefined || s.sideToMove === undefined || s.moveCount === undefined) {
        rows.push({ action: "conflict", key, data: {}, reason: "missing-required:fen/sideToMove/moveCount" });
        log.push(`conflict:missing-required opening ${key}`);
        continue;
      }
      const data: Record<string, unknown> = {
        eco: s.eco,
        name: s.name,
        pgn: s.pgn,
        fen: s.fen,
        sideToMove: s.sideToMove,
        moveCount: s.moveCount,
        ...desired,
      };
      if (s.referenceId) data.referenceId = s.referenceId;
      if (s.createdAt) data.createdAt = s.createdAt;
      rows.push({ action: "insert", key, data });
      continue;
    }
    const { data, changed } = diff(desired, match);
    rows.push(
      changed.length === 0
        ? { action: "unchanged", key, id: match.id, data: {} }
        : { action: "update", key, id: match.id, data, changed },
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Entry point

export function planContent(source: SourceSnapshot, target: TargetSnapshot): ContentPlan {
  const log: string[] = [];
  const { rows: legends, index } = planLegends(source.legends, target.legends, log);
  const positions = planPositions(source.positions, target.positions, index, log);
  const openings = planOpenings(source.openings, target.openings, log);
  return { legends, positions, openings, log };
}

export type PlanCounts = Record<Action, number>;

export function countActions(rows: PlanRow[]): PlanCounts {
  const c: PlanCounts = { insert: 0, update: 0, unchanged: 0, conflict: 0 };
  for (const r of rows) c[r.action]++;
  return c;
}

export function hasWrites(rows: PlanRow[]): boolean {
  return rows.some((r) => r.action === "insert" || r.action === "update");
}

// ---------------------------------------------------------------------------
// Design fixtures as a source snapshot (SPEC §11.2 tables)

export function fixtureSnapshot(): SourceSnapshot {
  const legends: SourceLegend[] = FIXTURE_LEGENDS.map((l) => ({
    name: l.name,
    era: l.era,
    nationality: l.nationality,
    birthYear: l.birthYear,
    deathYear: l.deathYear,
    peakRating: l.peakRating,
    playingStyle: l.playingStyle,
    shortDescription: l.shortDescription,
    achievements: [...l.achievements],
    famousGames: famousGamesFor(l.name),
    isActive: true,
    isVisible: true,
    // profilePhotoUrl is left unmanaged: inserts get the column default (null),
    // and a photo added later survives a re-run.
  }));
  const positions: SourcePosition[] = FIXTURE_POSITIONS.map((p) => ({
    fen: p.fen,
    sideToMove: p.sideToMove,
    pgn: p.pgn,
    moveNumber: moveNumberFromFen(p.fen),
    whitePlayerName: p.white,
    blackPlayerName: p.black,
    whiteLegend: p.whiteIsLegend ? { name: p.white } : null,
    blackLegend: p.blackIsLegend ? { name: p.black } : null,
    tournamentName: p.tournamentName,
    eventDate: new Date(Date.UTC(p.year, 0, 1)),
    gameMetadata: { datePrecision: "year" },
    positionType: "legend",
    positionContext: { theme: p.theme },
    sourceType: DESIGN_FIXTURE_SOURCE_TYPE,
    featured: true,
    isActive: true,
  }));
  return { legends, positions, openings: [] };
}

// ---------------------------------------------------------------------------
// JSON export / old-prod read → SourceSnapshot (column whitelist, F §4.5)

type Kind = "string" | "number" | "boolean" | "json" | "date";

const LEGEND_COLUMNS: Record<string, Kind> = {
  referenceId: "string",
  name: "string",
  era: "string",
  profilePhotoUrl: "string",
  peakRating: "number",
  nationality: "string",
  shortDescription: "string",
  playingStyle: "string",
  birthYear: "number",
  deathYear: "number",
  achievements: "json",
  famousGames: "json",
  isActive: "boolean",
  isVisible: "boolean",
  createdAt: "date",
};

// `sourceMetadata` is deliberately absent: it is dropped on the json/db paths.
const POSITION_COLUMNS: Record<string, Kind> = {
  referenceId: "string",
  fen: "string",
  sideToMove: "string",
  pgn: "string",
  moveNumber: "number",
  whitePlayerName: "string",
  blackPlayerName: "string",
  whitePlayerMetadata: "json",
  blackPlayerMetadata: "json",
  tournamentName: "string",
  eventDate: "date",
  gameMetadata: "json",
  positionType: "string",
  positionContext: "json",
  explanation: "json",
  explanationAudioUrl: "string",
  sourceType: "string",
  popularityScore: "number",
  featured: "boolean",
  isActive: "boolean",
  createdAt: "date",
};

const OPENING_COLUMNS: Record<string, Kind> = {
  referenceId: "string",
  eco: "string",
  name: "string",
  pgn: "string",
  fen: "string",
  sideToMove: "string",
  moveCount: "number",
  isActive: "boolean",
  explanation: "json",
  explanationAudioUrl: "string",
  createdAt: "date",
};

/** Columns that are NOT NULL in the schema; a null for them is a data error, not SQL NULL. */
const NOT_NULL: Record<string, ReadonlySet<string>> = {
  legends: new Set(["referenceId", "name", "era", "shortDescription", "isActive", "isVisible", "createdAt"]),
  chess_positions: new Set(["referenceId", "fen", "sideToMove", "sourceType", "featured", "isActive", "createdAt"]),
  openings: new Set(["referenceId", "eco", "name", "pgn", "fen", "sideToMove", "moveCount", "isActive", "createdAt"]),
};

function coerce(table: string, col: string, kind: Kind, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) {
    if (kind === "json") return DB_NULL;
    if (NOT_NULL[table]?.has(col)) throw new Error(`${table}.${col} is null in the export`);
    return null;
  }
  switch (kind) {
    case "json":
      return v as JsonValue;
    case "date": {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new Error(`${table}.${col} is not a date`);
      return d;
    }
    case "number": {
      const n = typeof v === "bigint" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${table}.${col} is not a number`);
      return n;
    }
    default:
      if (typeof v !== kind) throw new Error(`${table}.${col} is not a ${kind}`);
      return v;
  }
}

function whitelist(table: string, raw: unknown, cols: Record<string, Kind>, dropped: Set<string>) {
  if (!isPlainObject(raw)) throw new Error(`${table}: row is not an object`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const kind = cols[k];
    if (!kind) {
      dropped.add(`${table}.${k}`);
      continue;
    }
    const c = coerce(table, k, kind, v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function legendRefFrom(v: unknown): LegendRef | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new Error("chess_positions.white/blackLegendRef is not a string");
  return { referenceId: v };
}

export interface NormalizedSource {
  snapshot: SourceSnapshot;
  /** Source columns that were not copied (always includes chess_positions.sourceMetadata when present). */
  droppedColumns: string[];
}

/**
 * Normalizes a 05 §4.4 export `{ legends, positions, openings, openingKeys? }`
 * (or the same shape read from old prod) into a SourceSnapshot.
 * Positions name legends by `whiteLegendRef` / `blackLegendRef` (legend referenceId).
 */
export function normalizeExport(raw: unknown): NormalizedSource {
  if (!isPlainObject(raw)) throw new Error("export is not an object");
  const dropped = new Set<string>();
  const arr = (k: string): unknown[] => {
    const v = raw[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error(`export.${k} is not an array`);
    return v;
  };

  const legends = arr("legends").map((r) => {
    const o = whitelist("legends", r, LEGEND_COLUMNS, dropped);
    if (typeof o.name !== "string") throw new Error("legends.name is missing");
    return o as unknown as SourceLegend;
  });

  const positions = arr("positions").map((r) => {
    const rec = isPlainObject(r) ? { ...r } : r;
    let whiteLegend: LegendRef | null | undefined;
    let blackLegend: LegendRef | null | undefined;
    if (isPlainObject(rec)) {
      whiteLegend = legendRefFrom(rec.whiteLegendRef);
      blackLegend = legendRefFrom(rec.blackLegendRef);
      delete rec.whiteLegendRef;
      delete rec.blackLegendRef;
      // Source-side ids and FK ids (whitePlayerId, …) are not whitelisted: legends are remapped by referenceId.
    }
    const o = whitelist("chess_positions", rec, POSITION_COLUMNS, dropped) as unknown as SourcePosition;
    if (typeof o.fen !== "string") throw new Error("chess_positions.fen is missing");
    if (whiteLegend !== undefined) o.whiteLegend = whiteLegend;
    if (blackLegend !== undefined) o.blackLegend = blackLegend;
    return o;
  });

  const openingsByKey = new Map<string, SourceOpening>();
  // `openingKeys`: every source opening (no content) so missing keys can be inserted.
  for (const r of [...arr("openingKeys"), ...arr("openings")]) {
    const row = Array.isArray(r) ? { eco: r[0], name: r[1], pgn: r[2] } : r;
    const o = whitelist("openings", row, OPENING_COLUMNS, dropped) as unknown as SourceOpening;
    if (typeof o.eco !== "string" || typeof o.name !== "string" || typeof o.pgn !== "string") {
      throw new Error("openings: eco/name/pgn missing");
    }
    const key = openingKey(o);
    openingsByKey.set(key, { ...openingsByKey.get(key), ...o });
  }

  return { snapshot: { legends, positions, openings: [...openingsByKey.values()] }, droppedColumns: [...dropped].sort() };
}

/** Distinct media hosts in a snapshot (logged on json/db runs: they still point at the prod bucket). */
export function mediaHosts(s: SourceSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (kind: string, url: string | null | undefined) => {
    if (!url) return;
    let host = "(unparseable)";
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep placeholder */
    }
    const k = `${kind} ${host}`;
    out[k] = (out[k] ?? 0) + 1;
  };
  for (const l of s.legends) add("legend.profilePhotoUrl", l.profilePhotoUrl);
  for (const p of s.positions) add("position.explanationAudioUrl", p.explanationAudioUrl);
  for (const o of s.openings) add("opening.explanationAudioUrl", o.explanationAudioUrl);
  return out;
}

// ---------------------------------------------------------------------------
// --retire-placeholders (05 §4.3, off by default)

/** Deactivate the "Various" placeholder positions from prisma/seed.ts so matchmaking skips them. */
export function planRetirePlaceholders(target: TargetPosition[]): PlanRow[] {
  return target
    .filter((t) => t.sourceType === "manual" && t.whitePlayerName === "Various")
    .map((t) =>
      t.isActive
        ? { action: "update" as const, key: t.fen, id: t.id, data: { isActive: false }, changed: ["isActive"] }
        : { action: "unchanged" as const, key: t.fen, id: t.id, data: {} },
    );
}

// ---------------------------------------------------------------------------
// --with-tournament-fixtures (05 §6, off by default): synthetic, owned by the seed bot

export const TOURNAMENT_FIXTURE_OWNER_EMAIL = "bot@replaychess.local";
export const TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS = [
  "alice@replaychess.local",
  "bob@replaychess.local",
  "charlie@replaychess.local",
  "diana@replaychess.local",
  "evan@replaychess.local",
] as const;

export interface TournamentFixture {
  name: string;
  status: "LOBBY" | "ACTIVE" | "COMPLETED";
  initialTimeSeconds: number;
  incrementSeconds: number;
  durationMinutes: number;
  maxParticipants: number;
  /** Points per participant in TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS order (COMPLETED only). */
  results?: { points: number; wins: number; draws: number; losses: number }[];
}

export const TOURNAMENT_FIXTURES: readonly TournamentFixture[] = [
  { name: "Dev fixture: Lobby Arena", status: "LOBBY", initialTimeSeconds: 300, incrementSeconds: 3, durationMinutes: 30, maxParticipants: 16 },
  { name: "Dev fixture: Live Arena", status: "ACTIVE", initialTimeSeconds: 180, incrementSeconds: 2, durationMinutes: 60, maxParticipants: 16 },
  {
    name: "Dev fixture: Finished Arena",
    status: "COMPLETED",
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    durationMinutes: 60,
    maxParticipants: 16,
    results: [
      { points: 3, wins: 3, draws: 0, losses: 1 },
      { points: 2.5, wins: 2, draws: 1, losses: 1 },
      { points: 2, wins: 2, draws: 0, losses: 2 },
      { points: 1.5, wins: 1, draws: 1, losses: 2 },
      { points: 1, wins: 1, draws: 0, losses: 3 },
    ],
  },
];

export interface TournamentTarget {
  ownerId: bigint | null;
  /** In TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS order; null when the seed user is missing. */
  participantIds: (bigint | null)[];
  tournaments: { id: bigint; name: string; createdByUserId: bigint }[];
  participants: { tournamentId: bigint; userId: bigint }[];
}

export interface PendingTournament {
  pendingTournament: string;
}

export function isPendingTournament(v: unknown): v is PendingTournament {
  return isPlainObject(v) && typeof v.pendingTournament === "string";
}

/**
 * Tournaments match by name among the bot's tournaments and are insert-only
 * (dates are relative to `now`, so an existing row is left alone).
 */
export function planTournamentFixtures(target: TournamentTarget, now: Date): { tournaments: PlanRow[]; participants: PlanRow[] } {
  const tournaments: PlanRow[] = [];
  const participants: PlanRow[] = [];
  if (target.ownerId === null) {
    tournaments.push({ action: "conflict", key: TOURNAMENT_FIXTURE_OWNER_EMAIL, data: {}, reason: "missing-owner-user" });
    return { tournaments, participants };
  }
  const minute = 60_000;
  for (const f of TOURNAMENT_FIXTURES) {
    const existing = target.tournaments.find((t) => t.name === f.name && t.createdByUserId === target.ownerId);
    let tournamentId: bigint | PendingTournament;
    if (existing) {
      tournaments.push({ action: "unchanged", key: f.name, id: existing.id, data: {} });
      tournamentId = existing.id;
    } else {
      const start =
        f.status === "LOBBY"
          ? new Date(now.getTime() + 60 * minute)
          : f.status === "ACTIVE"
            ? new Date(now.getTime() - 10 * minute)
            : new Date(now.getTime() - 7 * 24 * 60 * minute);
      const data: Record<string, unknown> = {
        name: f.name,
        description: "Synthetic dev fixture (seed-content --with-tournament-fixtures).",
        mode: "FREE",
        status: f.status,
        maxParticipants: f.maxParticipants,
        initialTimeSeconds: f.initialTimeSeconds,
        incrementSeconds: f.incrementSeconds,
        durationMinutes: f.durationMinutes,
        createdByUserId: target.ownerId,
        scheduledStartAt: start,
      };
      if (f.status !== "LOBBY") {
        data.startedAt = start;
        data.endsAt = new Date(start.getTime() + f.durationMinutes * minute);
      }
      if (f.status === "COMPLETED") data.completedAt = data.endsAt;
      tournaments.push({ action: "insert", key: f.name, data });
      tournamentId = { pendingTournament: f.name };
    }
    target.participantIds.forEach((userId, i) => {
      const pkey = `${f.name} / ${TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS[i]}`;
      if (userId === null) {
        participants.push({ action: "conflict", key: pkey, data: {}, reason: "missing-seed-user" });
        return;
      }
      const has =
        typeof tournamentId === "bigint" &&
        target.participants.some((p) => p.tournamentId === tournamentId && p.userId === userId);
      if (has) {
        participants.push({ action: "unchanged", key: pkey, data: {} });
        return;
      }
      const r = f.results?.[i];
      participants.push({
        action: "insert",
        key: pkey,
        data: {
          tournamentId,
          userId,
          ...(r ? { points: r.points, wins: r.wins, draws: r.draws, losses: r.losses, gamesPlayed: r.wins + r.draws + r.losses } : {}),
        },
      });
    });
  }
  return { tournaments, participants };
}
