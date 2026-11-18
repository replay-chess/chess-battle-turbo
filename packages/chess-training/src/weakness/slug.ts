// Pattern slugs (phase-06 plan §4.1): `/train/weakness/[pattern]` carries the kebab-case slug of a weakness
// candidate key. CamelCase becomes kebab-case and the `rc:` prefix is dropped: "hangingPiece" → "hanging-piece",
// "backRankMate" → "back-rank-mate", "rc:timePressure" → "time-pressure", "mateIn2" → "mate-in-2". Only weakness
// candidates have slugs that resolve; anything else is null (the page redirects, TR-7 answers 400). Browser-safe.
import { WEAKNESS_CANDIDATES } from "../themes";

/** "hangingPiece" → "hanging-piece"; "rc:timePressure" → "time-pressure"; "mateIn2" → "mate-in-2". */
export function patternSlug(key: string): string {
  return key
    .replace(/^rc:/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

const BY_SLUG: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const key of WEAKNESS_CANDIDATES) {
    const slug = patternSlug(key);
    // Two candidates must never share a slug (`fork` and `rc:fork` would): the table is checked at load.
    if (m.has(slug)) throw new Error(`weakness slug "${slug}" is shared by ${m.get(slug)} and ${key}`);
    m.set(slug, key);
  }
  return m;
})();

/** The candidate key of a slug, or null (unknown, malformed, or not a weakness candidate). */
export function patternFromSlug(slug: string): string | null {
  if (typeof slug !== "string" || slug.length > 40 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  return BY_SLUG.get(slug) ?? null;
}
