// The runner pages' entry params → the session to create or resume (phase-05 plan §4.4 "Route", §4.5 "Route").
//
//   /train/bank/session   ?s=<ref> resume · ?plan=1 DAILY · ?card=<itemKey> BANK "Solve this one" · ?cards=a,b,c BANK
//                         explicit · ?game=<gameRef> BANK (the game's in-bank moments, from Review complete) ·
//                         ?theme=&phase=&source=own|missed&practice=1 BANK (the bank list's filter) · none → BANK due
//   /train/puzzles        ?s=<ref> resume · ?theme=fork · ?n=3 (plan step: n puzzles then done) · ?pick=1 (open the
//                         picker) · ?source=plan|hub|summary|nav|bank
// `from=` names the surface for telemetry when the path alone does not (Home thumbnails, the hub's due strip). Pure and
// zod-free; the page validates the result with the contract schema before calling the service.
import type { SessionCreateInput, SessionSource } from "@repo/contracts/http/train";

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const ITEM_KEY = /^[mpo]_[A-Za-z0-9]{1,24}$/;
const REF = /^c[a-z0-9]{20,31}$/;
const THEME = /^(rc:)?[A-Za-z0-9]{2,30}$/;
const SOURCES: readonly SessionSource[] = ["hub", "plan", "bank", "review_complete", "summary", "nav", "solve_one", "home", "picker", "deeplink"];
const PHASES = ["opening", "middlegame", "endgame"] as const;

function sourceOf(sp: SearchParams, key: string, fallback: SessionSource): SessionSource {
  const v = one(sp[key]);
  return SOURCES.includes(v as SessionSource) ? (v as SessionSource) : fallback;
}

/** `?s=` when it looks like a session ref (the service still answers 404 for a foreign or missing one). */
export function resumeRef(sp: SearchParams): string | null {
  const s = one(sp.s);
  return s && REF.test(s) ? s : null;
}

/** The bank runner's create spec from its URL. */
export function bankSpec(sp: SearchParams): SessionCreateInput {
  if (one(sp.plan) === "1") return { kind: "daily", source: "plan" };
  const card = one(sp.card);
  if (card && ITEM_KEY.test(card)) return { kind: "bank", source: sourceOf(sp, "from", "solve_one"), cardRefs: [card] };
  const cards = (one(sp.cards) ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => ITEM_KEY.test(c));
  if (cards.length) return { kind: "bank", source: sourceOf(sp, "from", "bank"), cardRefs: [...new Set(cards)].slice(0, 20) };
  const game = one(sp.game);
  if (game && REF.test(game)) return { kind: "bank", source: sourceOf(sp, "from", "review_complete"), gameRef: game };
  const theme = one(sp.theme);
  const phase = one(sp.phase);
  const source = one(sp.source);
  const filter = {
    ...(theme && THEME.test(theme) ? { theme } : {}),
    ...(PHASES.includes(phase as (typeof PHASES)[number]) ? { phase: phase as (typeof PHASES)[number] } : {}),
    ...(source === "own" || source === "missed" ? { source: source as "own" | "missed" } : {}),
  };
  const practice = one(sp.practice) === "1";
  const hasFilter = Object.keys(filter).length > 0;
  return {
    kind: "bank",
    source: sourceOf(sp, "from", hasFilter || practice ? "bank" : "hub"),
    ...(hasFilter ? { filter } : {}),
    ...(practice ? { practice: true } : {}),
  };
}

/** The puzzle runner's create spec from its URL. */
export function puzzlesSpec(sp: SearchParams): SessionCreateInput {
  const theme = one(sp.theme);
  const n = Number(one(sp.n));
  return {
    kind: "puzzles",
    source: sourceOf(sp, "source", "nav"),
    ...(theme && THEME.test(theme) ? { theme } : {}),
    ...(Number.isInteger(n) && n >= 1 && n <= 10 ? { count: n } : {}),
  };
}

/** The source a created session reports (`train_session_started.source`). */
export function specSource(spec: SessionCreateInput): SessionSource {
  return spec.kind === "practice" ? "deeplink" : (spec.source ?? "plan");
}

/** `?pick=1`: open the theme picker on load. */
export function wantsPicker(sp: SearchParams): boolean {
  return one(sp.pick) === "1";
}

/** The page's own URL, for the sign-in / paywall `returnTo`. */
export function returnPath(path: string, sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v);
    if (val !== undefined) q.set(k, val);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The summary's `?n=` (attempts graded on the device, 0–40), or null when absent or malformed. */
export function clientGradedOf(v: string | string[] | undefined): number | null {
  const raw = one(v);
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 40 ? n : null;
}
