// Command palette rows and filtering (SPEC 8.2 CommandPalette). Pure: the
// component maps ids to icons and runs the actions.
import { destination, destinationHref, membershipHref, type Me } from "../nav/destinations";

export type PaletteGroup = "goto" | "actions" | "legends";
export type PaletteAction = "shortcuts" | "theme" | "signout";

export type PaletteRow = {
  /** testid `palette-item-<id>` */
  id: string;
  group: PaletteGroup;
  /** Title Case. */
  title: string;
  hint?: string;
  href?: string;
  action?: PaletteAction;
};

export const PALETTE_GROUPS: { id: PaletteGroup; heading: string }[] = [
  { id: "goto", heading: "Go To" },
  { id: "actions", heading: "Actions" },
  { id: "legends", heading: "Legends" },
];

export const QUICK_MATCH_HREF = "/queue?time=300&increment=3";

/**
 * The Phase 1 rows, in curated order. No Home, My Games, Mistake Bank, Review
 * or Ask-the-Coach rows: those destinations don't exist yet.
 */
export function buildPaletteRows({
  me,
  isAdmin,
  theme,
  demo = false,
}: {
  me: Me;
  isAdmin: boolean;
  /** The resolved theme now; the row offers the other one. */
  theme: "light" | "dark";
  demo?: boolean;
}): PaletteRow[] {
  const go = (key: "play" | "tournaments" | "legends" | "openings" | "profile", hint?: string): PaletteRow => {
    const d = destination(key);
    return { id: key, group: "goto", title: d.label, hint, href: destinationHref(d, me, { demo }) };
  };
  const rows: PaletteRow[] = [
    go("play", "G then P"),
    go("tournaments"),
    go("legends", "G then L"),
    go("openings"),
    go("profile"),
    { id: "membership", group: "goto", title: "Membership", href: membershipHref(me, demo) },
    { id: "find-opponent", group: "actions", title: "Find an Opponent · 5+3", href: QUICK_MATCH_HREF },
    { id: "challenge", group: "actions", title: "Challenge a Friend", href: "/challenge/new" },
    { id: "shortcuts", group: "actions", title: "Keyboard Shortcuts", hint: "?", action: "shortcuts" },
    {
      id: "theme",
      group: "actions",
      title: theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme",
      action: "theme",
    },
  ];
  if (isAdmin) rows.push({ id: "admin", group: "actions", title: "Admin", href: "/admin" });
  if (!demo) rows.push({ id: "signout", group: "actions", title: "Sign Out", action: "signout" });
  return rows;
}

/** Case-insensitive substring match on `title + " " + hint`; keeps group order. */
export function filterRows(rows: PaletteRow[], query: string): PaletteRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => `${r.title} ${r.hint ?? ""}`.toLowerCase().includes(q));
}

export type LegendHit = { referenceId: string; name: string; isVisible?: boolean };

export const LEGEND_SEARCH_MIN = 2;
export const LEGEND_SEARCH_MAX = 5;
export const LEGEND_SEARCH_DEBOUNCE_MS = 150;

export function legendSearchUrl(query: string): string {
  return `/api/legends/search?name=${encodeURIComponent(query.trim())}`;
}

/** Reads `{ success, data: { legends } }`; anything else is no hits. */
export function parseLegendSearch(json: unknown): LegendHit[] {
  const legends = (json as { data?: { legends?: unknown } } | null)?.data?.legends;
  if (!Array.isArray(legends)) return [];
  return legends.filter(
    (l): l is LegendHit => Boolean(l) && typeof l.referenceId === "string" && typeof l.name === "string",
  );
}

/** Keep only visible legends (a hidden legend's page 404s), at most 5. */
export function legendRows(legends: LegendHit[]): PaletteRow[] {
  return legends
    .filter((l) => l.isVisible === true)
    .slice(0, LEGEND_SEARCH_MAX)
    .map((l) => ({
      id: `legend-${l.referenceId}`,
      group: "legends" as const,
      title: l.name,
      hint: "Legend",
      href: `/legends/${encodeURIComponent(l.referenceId)}`,
    }));
}
