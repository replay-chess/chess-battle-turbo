// The Mistake Bank's screen model (phase-05 plan §4.3, §5.2 S3; DR/V3MistakeBank.dc.html, V3BankEmpty/CaughtUp, the
// device boards). Pure: URL state, client filtering over a complete bank, group headers, selection, every
// data-generated string. No zod, no React: the route, the demo and the tests share it.
//
// URL state (cdl §6.4): `?view=due|all&theme=&phase=&source=own|missed&sel=<cardRef>`, written with
// `history.replaceState` so Back leaves the page instead of stepping through filter changes. No `view` = the default
// (the All list), except that a caught-up bank then shows its "All caught up" page; `?view=all` ("Browse All 23
// Positions") always shows the list.
//
// Small banks (≤ 300 cards) arrive whole on page 1 (`meta.complete`): the base query is the UNFILTERED bank
// (`BASE_BANK_FILTER`) and every tab, filter and clear runs here, instantly. Larger banks fetch one server page per
// filter (`serverFilterOf`).
import type { BankPage, BankRow, BankSourceW, Facet, NextBatch, PhaseW, SessionCreateInput } from "@repo/contracts/http/train";
import { DEFAULT_BANK_DAILY_CAP } from "@repo/chess-training/constants";
import type { BankFilter } from "@/lib/api/keys";

export const BANK_PATH = "/train/bank";
export const BANK_VIEWS = ["due", "all"] as const;
export type BankView = (typeof BANK_VIEWS)[number];
const PHASES: readonly PhaseW[] = ["opening", "middlegame", "endgame"];
const SOURCES: readonly BankSourceW[] = ["own", "missed"];
const THEME_KEY = /^(rc:)?[A-Za-z0-9]{2,30}$/;
const CARD_REF = /^[mpo]_[A-Za-z0-9]{1,24}$/;

/** The filters (not the selection): the part of the URL that decides which rows show. `view: null` = not chosen. */
export type BankFilterState = { view: BankView | null; theme: string | null; phase: PhaseW | null; source: BankSourceW | null };
export type BankUrlState = BankFilterState & { sel: string | null };
export type FilterGroup = "theme" | "phase" | "source";

export const EMPTY_FILTER: BankFilterState = { view: null, theme: null, phase: null, source: null };

/** The tab the list shows: the chosen one, else All. */
export function viewOf(f: Pick<BankFilterState, "view">): BankView {
  return f.view ?? "all";
}
/** The base query of the screen: the whole bank, so a complete bank is fetched once and filtered here. */
export const BASE_BANK_FILTER: BankFilter = {};

/** The daily cap the copy names when a page carries none (TrainingProfile.bankDailyCap's default, caps.ts). */
export { DEFAULT_BANK_DAILY_CAP };

type SearchLike = Record<string, string | string[] | undefined> | URLSearchParams;

function param(sp: SearchLike, name: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(name) ?? undefined;
  const v = sp[name];
  return Array.isArray(v) ? v[0] : v;
}

/** URL → state. Anything unknown or malformed falls back to the default (never an error page for a bad link). */
export function parseBankSearch(sp: SearchLike): BankUrlState {
  const view = param(sp, "view");
  const theme = param(sp, "theme");
  const phase = param(sp, "phase");
  const source = param(sp, "source");
  const sel = param(sp, "sel");
  return {
    view: view === "due" || view === "all" ? view : null,
    theme: theme && THEME_KEY.test(theme) ? theme : null,
    phase: PHASES.includes(phase as PhaseW) ? (phase as PhaseW) : null,
    source: SOURCES.includes(source as BankSourceW) ? (source as BankSourceW) : null,
    sel: sel && CARD_REF.test(sel) ? sel : null,
  };
}

/** State → the query string (canonical order, defaults omitted), "" for the default state. */
export function bankQueryString(state: BankUrlState): string {
  const p = new URLSearchParams();
  if (state.view) p.set("view", state.view);
  if (state.theme) p.set("theme", state.theme);
  if (state.phase) p.set("phase", state.phase);
  if (state.source) p.set("source", state.source);
  if (state.sel) p.set("sel", state.sel);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function bankHref(state: BankUrlState): string {
  return `${BANK_PATH}${bankQueryString(state)}`;
}

/** The R2 filter for one server page of a large bank (the selection is client state). */
export function serverFilterOf(f: BankFilterState): BankFilter {
  return {
    view: viewOf(f) === "due" ? "due" : undefined,
    theme: f.theme ?? undefined,
    phase: f.phase ?? undefined,
    source: f.source ?? undefined,
  };
}

export function activeFilterCount(f: BankFilterState): number {
  return (f.theme ? 1 : 0) + (f.phase ? 1 : 0) + (f.source ? 1 : 0);
}

export function isFiltered(f: BankFilterState): boolean {
  return activeFilterCount(f) > 0;
}

/** One group's option toggled (the groups are single-choice, as the design's chips: a second tap clears). */
export function toggled(f: BankFilterState, group: FilterGroup, key: string): BankFilterState {
  switch (group) {
    case "theme":
      return { ...f, theme: f.theme === key ? null : key };
    case "phase":
      return { ...f, phase: f.phase === key ? null : PHASES.includes(key as PhaseW) ? (key as PhaseW) : null };
    case "source":
      return { ...f, source: f.source === key ? null : SOURCES.includes(key as BankSourceW) ? (key as BankSourceW) : null };
  }
}

export function withoutGroup(f: BankFilterState, group: FilterGroup): BankFilterState {
  return { ...f, [group]: null };
}

/** Clear All: the filters go, the Due/All tab stays (it is not a filter). */
export function clearedFilters(f: BankFilterState): BankFilterState {
  return { ...f, theme: null, phase: null, source: null };
}

/** The row passes the theme, phase and source filters (the tab is applied separately). */
export function matchesFilters(row: BankRow, f: BankFilterState): boolean {
  if (f.theme && row.theme.key !== f.theme) return false;
  if (f.phase && row.phase !== f.phase) return false;
  if (f.source && row.source !== f.source) return false;
  return true;
}

/** "Pool" = the filtered bank whatever the tab (the design's Due · n / All · n counts and the CTA's n). */
export function poolOf(rows: readonly BankRow[], f: BankFilterState): BankRow[] {
  return rows.filter((r) => matchesFilters(r, f));
}

/** The rows the list shows: the pool, narrowed to due rows on the Due tab. Server order (by next review) is kept. */
export function visibleRowsOf(rows: readonly BankRow[], f: BankFilterState): BankRow[] {
  const pool = poolOf(rows, f);
  return viewOf(f) === "due" ? pool.filter((r) => r.isDue) : pool;
}

/** The selected row: `sel` if it is visible, else the first visible row, else none (§4.3 "Selected row disappears"). */
export function selectedRowOf(rows: readonly BankRow[], sel: string | null): BankRow | null {
  if (sel) {
    const hit = rows.find((r) => r.cardRef === sel);
    if (hit) return hit;
  }
  return rows[0] ?? null;
}

export type RowGroup = { id: "due" | "later" | "rows"; header: string | null; rows: BankRow[] };

/**
 * The list's groups. All tab: "Due today · n" then "Scheduled later · n" (each only when it has rows); Due tab: one
 * group without a header (every row is due).
 */
export function groupRows(rows: readonly BankRow[], view: BankView): RowGroup[] {
  if (view === "due") return rows.length ? [{ id: "rows", header: null, rows: [...rows] }] : [];
  const due = rows.filter((r) => r.isDue);
  const later = rows.filter((r) => !r.isDue);
  const out: RowGroup[] = [];
  if (due.length) out.push({ id: "due", header: `Due today · ${due.length}`, rows: due });
  if (later.length) out.push({ id: "later", header: `Scheduled later · ${later.length}`, rows: later });
  return out;
}

/** ~3 min for 4 cards: `round(0.75 n)`, at least 1 (§4.1). */
export function estMinutes(n: number): number {
  return Math.max(1, Math.round(0.75 * n));
}

export type BankCta =
  | { kind: "review"; label: string; due: number; practice: false }
  | { kind: "drill"; label: string; count: number; practice: true }
  | { kind: "none" };

/** The primary CTA over the pool: due cards → a review session; nothing due → a practice drill of the visible rows. */
export function ctaOf(pool: readonly BankRow[], visible: readonly BankRow[]): BankCta {
  const due = pool.filter((r) => r.isDue).length;
  if (due > 0) return { kind: "review", label: `Review ${due} Due · ~${estMinutes(due)} min`, due, practice: false };
  if (visible.length > 0) return { kind: "drill", label: `Drill These ${visible.length} · Nothing Due`, count: visible.length, practice: true };
  return { kind: "none" };
}

/**
 * Which body the page shows: the empty bank, "All caught up" (server state, while the member has not picked a tab or
 * a filter), or the list.
 */
export function bodyOf(page: Pick<BankPage, "state">, f: BankFilterState): "empty" | "caughtup" | "list" {
  if (page.state === "empty") return "empty";
  if (page.state === "caughtup" && f.view === null && !isFiltered(f)) return "caughtup";
  return "list";
}

/** The daily cap the page names (`counts.cap`, the member's `bankDailyCap`; a page from an older build: the default). */
export function capOf(page: Pick<BankPage, "counts">): number {
  const cap = page.counts.cap;
  return typeof cap === "number" && Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_BANK_DAILY_CAP;
}

/** "Next batch tomorrow 08:00" for the header tag (`day` from `dayWord`, already cased: "tomorrow", "Saturday"). */
export function nextBatchTag(nb: NextBatch | null, day: string | null): string | null {
  if (!nb) return null;
  return day ? `Next batch ${day} ${nb.atLabel}` : `Next batch ${nb.atLabel}`;
}

/** The list footer (design `.lfoot`). */
export function footerOf(page: BankPage, view: BankView, day: string | null): string {
  if (view === "all") return `Sorted by next review · FSRS keeps it to ${capOf(page)} a day`;
  const later = Math.max(0, page.counts.all - page.counts.due);
  const tail = page.nextBatch ? ` · next batch ${day ?? page.nextBatch.atLabel}` : "";
  return `${later} more scheduled for later days${tail}`;
}

/** "4 due" / "23 in bank" beside the tabs. */
export function countLabel(visible: number, view: BankView): string {
  return view === "due" ? `${visible} due` : `${visible} in bank`;
}

/** "Show 4 Positions" / "Show 1 Position"; "Show Positions" while the count is unknown (a large bank). */
export function showLabel(n: number | null): string {
  if (n === null) return "Show Positions";
  return `Show ${n} ${n === 1 ? "Position" : "Positions"}`;
}

export type FilterOption = { key: string; label: string; n: number };
export type FilterGroupModel = { group: FilterGroup; title: string; options: FilterOption[] };

const GROUP_TITLES: Record<FilterGroup, string> = { theme: "Theme", phase: "Phase", source: "Source" };

/** The popover's groups, from page 1's facets (labels and whole-bank counts). Empty groups are left out. */
export function filterGroupsOf(facets: BankPage["facets"]): FilterGroupModel[] {
  const groups: FilterGroupModel[] = (["theme", "phase", "source"] as const).map((g) => ({
    group: g,
    title: GROUP_TITLES[g],
    options: facets[g].map((x: Facet) => ({ key: x.key, label: x.label, n: x.n })),
  }));
  return groups.filter((g) => g.options.length > 0);
}

export type FilterChip = { group: FilterGroup; key: string; label: string };

/** The active filters as removable chips ("Remove filter Fork"). Labels from the facets, else the key itself. */
export function chipsOf(f: BankFilterState, facets: BankPage["facets"]): FilterChip[] {
  const label = (g: FilterGroup, key: string) => facets[g].find((x) => x.key === key)?.label ?? key;
  const out: FilterChip[] = [];
  if (f.theme) out.push({ group: "theme", key: f.theme, label: label("theme", f.theme) });
  if (f.phase) out.push({ group: "phase", key: f.phase, label: label("phase", f.phase) });
  if (f.source) out.push({ group: "source", key: f.source, label: label("source", f.source) });
  return out;
}

const JUDGEMENT_LABEL: Record<BankRow["judgement"], string> = {
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  miss: "Miss",
  blunder: "Blunder",
};
const PHASE_LABEL: Record<PhaseW, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };

export function judgementLabel(j: BankRow["judgement"]): string {
  return JUDGEMENT_LABEL[j];
}

/** The side to move from the FEN (field 2), as the eyebrow names it. */
export function sideToMoveOf(fen: string): "White" | "Black" {
  return fen.split(" ")[1] === "b" ? "Black" : "White";
}

/** "vs tal_fan_77 · today · move 19" (list rows). */
export function rowSubline(row: BankRow): string {
  return `vs ${row.opponent} · ${row.playedAtLabel} · move ${row.moveNo}`;
}

/** The row's thumbnail name: "Fork position from your game vs vera_b, move 24". */
export function rowBoardLabel(row: BankRow): string {
  return `${row.theme.label} position from your game vs ${row.opponent}, move ${row.moveNo}`;
}

export type DetailModel = {
  eyebrow: string;
  title: string;
  played: string;
  meta: string;
  mastery: string;
  boardLabel: string;
};

/** The selected position's info grid (`.mbinfo`). The best move is never here: it stays hidden until the member tries. */
export function detailOf(row: BankRow): DetailModel {
  const side = sideToMoveOf(row.fen);
  return {
    eyebrow: `${row.isDue ? "Due today" : `Next review ${row.nextLabel ?? "later"}`} · ${side} to move`,
    title: row.theme.label,
    played: `you played ${row.playedSan}`,
    meta: `${JUDGEMENT_LABEL[row.judgement]} · ${rowSubline(row)} · ${PHASE_LABEL[row.phase]}`,
    mastery: `Mastery ${row.mastery} of 5 · best move hidden until you try`,
    boardLabel: `${row.theme.label} position from your game vs ${row.opponent}. ${side} to move. Find the better move.`,
  };
}

export function masteryLabel(m: number): string {
  return `Mastery ${m} of 5`;
}

/** `/train/bank/session?card=<ref>`: the runner opened at one card (a session-creating URL: never prefetched). */
export function solveHref(cardRef: string): string {
  return `/train/bank/session?card=${encodeURIComponent(cardRef)}`;
}

/** "See It in Your Game": the review at the moment's ply (P3 maps the ply to its moment). */
export function seeInGameHref(row: Pick<BankRow, "gameRef" | "gamePly">): string {
  const ply = row.gamePly === null ? "" : `ply=${row.gamePly}&`;
  return `/review/${encodeURIComponent(row.gameRef)}?${ply}from=bank`;
}

/** The empty-bank example card's position (DR/V3BankEmpty: static, from the design). */
export const EXAMPLE_FEN = "r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 0 19";

export type CaughtUpModel = { title: string; body: string; browseLabel: string; upcomingMax: number; cap: number };

/**
 * "You reviewed today's 4 positions. The next batch of 6 arrives tomorrow at 08:00." The reviewed count is
 * `cap − capRemaining` (the cap is the reason when nothing remains: "You reviewed today's 10 positions.").
 */
export function caughtUpOf(page: BankPage, day: string | null): CaughtUpModel {
  const cap = capOf(page);
  const reviewed = Math.max(0, cap - page.counts.capRemaining);
  const first =
    reviewed > 0
      ? `You reviewed today’s ${reviewed} ${reviewed === 1 ? "position" : "positions"}.`
      : "Nothing is due today.";
  const nb = page.nextBatch;
  const when = nb ? `${day ? `${day} ` : ""}at ${nb.atLabel}` : null;
  const second =
    nb && nb.count > 0 && when
      ? ` The next batch of ${nb.count} arrives ${when}.`
      : page.counts.dueRaw > page.counts.due
        ? ` ${page.counts.dueRaw - page.counts.due} more wait for tomorrow.`
        : "";
  return {
    title: "All caught up",
    body: `${first}${second}`,
    browseLabel: `Browse All ${page.counts.all} ${page.counts.all === 1 ? "Position" : "Positions"}`,
    upcomingMax: Math.max(1, ...page.upcoming.map((u) => u.n)),
    cap,
  };
}

/** The header's tags ("4 due today", "23 in bank"). */
export function headerTags(page: BankPage): { due: string; total: string } {
  return { due: `${page.counts.due} due today`, total: `${page.counts.all} in bank` };
}

/** W2's body for the list CTA: the active filters (none → no filter), practice when nothing is due. */
export function bankSessionBody(f: BankFilterState, cta: Exclude<BankCta, { kind: "none" }>): SessionCreateInput {
  const filter = {
    ...(f.theme ? { theme: f.theme } : {}),
    ...(f.phase ? { phase: f.phase } : {}),
    ...(f.source ? { source: f.source } : {}),
  };
  return { kind: "bank", source: "bank", ...(Object.keys(filter).length ? { filter } : {}), practice: cta.practice };
}

