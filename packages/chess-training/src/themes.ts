// Theme taxonomy (phase-05 plan §8.11): Lichess puzzle theme keys verbatim (R-THM-01), so a bank card tagged `fork`
// matches CC0 `fork` puzzles; own-mistake patterns with no Lichess key carry the `rc:` prefix. Display labels live only
// in this table (R-THM-08). Browser-safe and pure.
//
// Shard bitmask: every Lichess key the shards keep has a fixed bit (`SHARD_THEME_BITS`, append-only: a bit number is
// part of the shard format, `puzzles/manifest.v1.json` copies the table). The plan reserves 64 bits; the table keeps
// to 53 so a mask is an exact JSON number (`Number.MAX_SAFE_INTEGER`), and the rarest named mate patterns
// (Anastasia, Arabian, Boden, double bishop, dovetail, hook) are left out: those puzzles still carry `mate`/`mateInN`.
// `rc:*` keys never get a bit.

export const THEME_GROUP_KEYS = ["recommended", "tactics", "material", "mates", "defence", "special", "endgames"] as const;
export type ThemeGroup = (typeof THEME_GROUP_KEYS)[number];

/** How a theme is used: shown in the picker and as a card theme, a Lichess-only tag, or an `rc:` review heuristic. */
export type ThemeKind = "tactic" | "mate" | "endgame" | "phase" | "meta" | "review";

export interface ThemeInfo {
  /** Singular label for a card or row: "Fork", "Loose piece", "Recapture first". */
  label: string;
  /** Picker and mastery label: "Forks", "Loose pieces", "Back rank". */
  plural: string;
  group: Exclude<ThemeGroup, "recommended">;
  kind: ThemeKind;
  /** The shard bit (`SHARD_THEME_BITS`), null for `rc:*`, `mix` and keys the shards do not carry. */
  bit: number | null;
}

const t = (label: string, plural: string, group: ThemeInfo["group"], kind: ThemeKind): ThemeInfo => ({ label, plural, group, kind, bit: null });

const TABLE: Readonly<Record<string, ThemeInfo>> = {
  // Tactics
  fork: t("Fork", "Forks", "tactics", "tactic"),
  pin: t("Pin", "Pins", "tactics", "tactic"),
  skewer: t("Skewer", "Skewers", "tactics", "tactic"),
  discoveredAttack: t("Discovered attack", "Discovered attack", "tactics", "tactic"),
  doubleCheck: t("Double check", "Double check", "tactics", "tactic"),
  capturingDefender: t("Remove the defender", "Remove the defender", "tactics", "tactic"),
  sacrifice: t("Sacrifice", "Sacrifice", "tactics", "tactic"),
  deflection: t("Deflection", "Deflection", "tactics", "tactic"),
  attraction: t("Attraction", "Attraction", "tactics", "tactic"),
  clearance: t("Clearance", "Clearance", "tactics", "tactic"),
  interference: t("Interference", "Interference", "tactics", "tactic"),
  intermezzo: t("Intermezzo", "Intermezzo", "tactics", "tactic"),
  xRayAttack: t("X-ray attack", "X-ray attack", "tactics", "tactic"),
  quietMove: t("Quiet move", "Quiet move", "tactics", "tactic"),
  exposedKing: t("Exposed king", "Exposed king", "tactics", "tactic"),
  kingsideAttack: t("Kingside attack", "Kingside attack", "tactics", "tactic"),
  queensideAttack: t("Queenside attack", "Queenside attack", "tactics", "tactic"),
  attackingF2F7: t("Attacking f2 or f7", "Attacking f2 or f7", "tactics", "tactic"),
  // Material
  hangingPiece: t("Loose piece", "Loose pieces", "material", "tactic"),
  trappedPiece: t("Trapped piece", "Trapped piece", "material", "tactic"),
  // Mates
  mate: t("Checkmate", "Checkmate", "mates", "mate"),
  mateIn1: t("Mate in 1", "Mate in 1", "mates", "mate"),
  mateIn2: t("Mate in 2", "Mate in 2", "mates", "mate"),
  mateIn3: t("Mate in 3", "Mate in 3", "mates", "mate"),
  mateIn4: t("Mate in 4", "Mate in 4", "mates", "mate"),
  mateIn5: t("Mate in 5 or more", "Mate in 5 or more", "mates", "mate"),
  backRankMate: t("Back rank", "Back rank", "mates", "mate"),
  smotheredMate: t("Smothered mate", "Smothered mate", "mates", "mate"),
  // Defence
  defensiveMove: t("Defend the threat", "Defend the threat", "defence", "tactic"),
  zugzwang: t("Zugzwang", "Zugzwang", "defence", "tactic"),
  // Special moves
  advancedPawn: t("Advanced pawn", "Advanced pawn", "special", "tactic"),
  promotion: t("Promotion", "Promotion", "special", "tactic"),
  underPromotion: t("Underpromotion", "Underpromotion", "special", "tactic"),
  enPassant: t("En passant", "En passant", "special", "tactic"),
  castling: t("Castling", "Castling", "special", "tactic"),
  // Endgames
  endgame: t("Endgame", "Endgame", "endgames", "phase"),
  rookEndgame: t("Rook endgame", "Rook endgame", "endgames", "endgame"),
  pawnEndgame: t("Pawn endgame", "Pawn endgame", "endgames", "endgame"),
  bishopEndgame: t("Bishop endgame", "Bishop endgame", "endgames", "endgame"),
  knightEndgame: t("Knight endgame", "Knight endgame", "endgames", "endgame"),
  queenEndgame: t("Queen endgame", "Queen endgame", "endgames", "endgame"),
  queenRookEndgame: t("Queen and rook", "Queen and rook", "endgames", "endgame"),
  // Phase, evaluation and length tags (never primary)
  opening: t("Opening", "Opening", "special", "phase"),
  middlegame: t("Middlegame", "Middlegame", "special", "phase"),
  advantage: t("Advantage", "Advantage", "special", "meta"),
  crushing: t("Crushing", "Crushing", "special", "meta"),
  equality: t("Equality", "Equality", "special", "meta"),
  oneMove: t("One-move", "One-move", "special", "meta"),
  short: t("Short", "Short", "special", "meta"),
  long: t("Long", "Long", "special", "meta"),
  veryLong: t("Very long", "Very long", "special", "meta"),
  // Own-mistake review heuristics (rct-b §3.8): no Lichess key, never in shards
  "rc:recapture": t("Recapture first", "Recapture first", "tactics", "review"),
  "rc:defendedTarget": t("Defended pawn", "Defended targets", "material", "review"),
  "rc:pawnStructure": t("Pawn structure", "Pawn structure", "special", "review"),
  "rc:kingSafety": t("King safety", "King safety", "defence", "review"),
  "rc:development": t("Development", "Development", "special", "review"),
  "rc:missedThreat": t("Missed threat", "Missed threats", "defence", "review"),
};

/** The shards' "any theme" bucket. */
export const MIX: ThemeInfo = t("Mixed", "Mixed", "special", "meta");

/**
 * Shard bit per Lichess key. APPEND-ONLY: never reorder or remove a key once shards were built with it (a removed key
 * leaves its bit unused). At most 53 entries (exact JSON numbers).
 */
export const SHARD_THEME_BITS: readonly string[] = Object.freeze([
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "hangingPiece",
  "trappedPiece",
  "capturingDefender",
  "sacrifice",
  "deflection",
  "attraction",
  "clearance",
  "interference",
  "intermezzo",
  "xRayAttack",
  "quietMove",
  "defensiveMove",
  "zugzwang",
  "exposedKing",
  "kingsideAttack",
  "queensideAttack",
  "attackingF2F7",
  "advancedPawn",
  "promotion",
  "underPromotion",
  "enPassant",
  "castling",
  "mate",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mateIn4",
  "mateIn5",
  "backRankMate",
  "smotheredMate",
  "endgame",
  "rookEndgame",
  "pawnEndgame",
  "bishopEndgame",
  "knightEndgame",
  "queenEndgame",
  "queenRookEndgame",
  "opening",
  "middlegame",
  "advantage",
  "crushing",
  "equality",
  "oneMove",
  "short",
  "long",
  "veryLong",
]);

const BIT_OF: ReadonlyMap<string, number> = new Map(SHARD_THEME_BITS.map((k, i) => [k, i]));

/** Every theme key the product knows: labels, picker group, kind and shard bit. */
export const THEMES: Readonly<Record<string, ThemeInfo>> = Object.freeze(
  Object.fromEntries(Object.entries(TABLE).map(([key, info]) => [key, Object.freeze({ ...info, bit: BIT_OF.get(key) ?? null })])),
);

/** The picker (§8.11): the first six are shown, the rest sit under "More themes". */
export const PICKER_THEMES: readonly string[] = Object.freeze([
  "fork",
  "pin",
  "hangingPiece",
  "backRankMate",
  "mateIn2",
  "discoveredAttack",
  "skewer",
  "capturingDefender",
  "trappedPiece",
  "sacrifice",
  "deflection",
  "attraction",
  "mateIn1",
  "mateIn3",
  "defensiveMove",
  "rookEndgame",
  "pawnEndgame",
]);
export const PICKER_MAIN_COUNT = 6;

/**
 * Primary-theme priority (§8.11): mates > fork > pin > skewer > discovered attack > double check > loose piece >
 * trapped piece > remove the defender > other tactics > `rc:*` > endgames > phase. Meta tags are never primary.
 */
const PRIORITY: readonly string[] = [
  "smotheredMate",
  "backRankMate",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mateIn4",
  "mateIn5",
  "mate",
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "hangingPiece",
  "trappedPiece",
  "capturingDefender",
  "sacrifice",
  "deflection",
  "attraction",
  "clearance",
  "interference",
  "intermezzo",
  "xRayAttack",
  "attackingF2F7",
  "exposedKing",
  "kingsideAttack",
  "queensideAttack",
  "promotion",
  "underPromotion",
  "advancedPawn",
  "enPassant",
  "castling",
  "defensiveMove",
  "quietMove",
  "zugzwang",
  "rc:recapture",
  "rc:defendedTarget",
  "rc:missedThreat",
  "rc:kingSafety",
  "rc:pawnStructure",
  "rc:development",
  "rookEndgame",
  "pawnEndgame",
  "bishopEndgame",
  "knightEndgame",
  "queenEndgame",
  "queenRookEndgame",
  "endgame",
  "opening",
  "middlegame",
];
const RANK: ReadonlyMap<string, number> = new Map(PRIORITY.map((k, i) => [k, i]));

const THEME_KEY_RE = /^(rc:)?[A-Za-z0-9]{2,30}$/;

/** True for a key that fits the wire format (`ThemeKey`), known or not. */
export function isThemeKey(key: string): boolean {
  return THEME_KEY_RE.test(key);
}

/** True for a key this table knows (or `mix`). */
export function isKnownTheme(key: string): boolean {
  return key === "mix" || Object.hasOwn(THEMES, key);
}

export function isReviewTheme(key: string): boolean {
  return key.startsWith("rc:");
}

/** "bodenMate" → "Boden mate" (a Lichess key this table does not list still gets a readable label). */
function humanize(key: string): string {
  const words = key
    .replace(/^rc:/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function themeInfo(key: string): ThemeInfo {
  if (key === "mix") return MIX;
  return THEMES[key] ?? t(humanize(key), humanize(key), "tactics", key.startsWith("rc:") ? "review" : "tactic");
}

/** Singular label ("Fork", "Loose piece"): card tags, bank rows and filters. */
export function themeLabel(key: string): string {
  return themeInfo(key).label;
}

/** Picker and mastery label ("Forks", "Loose pieces"). */
export function themePluralLabel(key: string): string {
  return themeInfo(key).plural;
}

/** The lowercase noun in sentences: "3 fork puzzles at your level", "Keep going: fork puzzles". */
export function themeNoun(key: string): string {
  return themeLabel(key).toLowerCase();
}

/** The picker group a theme sits in (the focus theme is shown under "recommended" by the caller). */
export function themeGroup(key: string): Exclude<ThemeGroup, "recommended"> {
  return themeInfo(key).group;
}

/** The highest-priority theme among `keys` (§8.11); meta tags never win. Null when no key qualifies. */
export function primaryTheme(keys: readonly string[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const k of keys) {
    if (themeInfo(k).kind === "meta") continue;
    // An unlisted key ranks after the listed ones of its kind: `rc:*` after the review heuristics, others after the tactics.
    const r = RANK.get(k) ?? (k.startsWith("rc:") ? RANK.get("rc:development")! + 0.5 : RANK.get("zugzwang")! + 0.5);
    if (r < bestRank) {
      best = k;
      bestRank = r;
    }
  }
  return best;
}

/** The shard bit of a key, or null (`rc:*`, `mix` and unlisted keys have none). */
export function themeBit(key: string): number | null {
  return BIT_OF.get(key) ?? null;
}

/** A shard theme mask from keys (keys without a bit are ignored). */
export function themeMask(keys: Iterable<string>): number {
  // 53-bit masks: plain arithmetic (bitwise operators would truncate to 32 bits).
  const bits = new Set<number>();
  for (const k of keys) {
    const bit = BIT_OF.get(k);
    if (bit !== undefined) bits.add(bit);
  }
  let mask = 0;
  for (const bit of bits) mask += 2 ** bit;
  return mask;
}

/** The keys of a shard theme mask, in bit order. */
export function themesOfMask(mask: number): string[] {
  if (!Number.isSafeInteger(mask) || mask < 0) throw new RangeError("a theme mask is a non-negative safe integer");
  const out: string[] = [];
  for (let bit = 0; bit < SHARD_THEME_BITS.length; bit++) {
    if (Math.floor(mask / 2 ** bit) % 2 === 1) out.push(SHARD_THEME_BITS[bit]!);
  }
  return out;
}

/** True when the mask carries `key`. */
export function maskHas(mask: number, key: string): boolean {
  const bit = BIT_OF.get(key);
  return bit !== undefined && Math.floor(mask / 2 ** bit) % 2 === 1;
}

/** `{key: bit}` for the shard manifest's `bits` table. */
export function shardBitsTable(): Record<string, number> {
  return Object.fromEntries(SHARD_THEME_BITS.map((k, i) => [k, i]));
}
