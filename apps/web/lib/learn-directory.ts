import { prisma } from "@/lib/prisma";

// Helpers behind the public /learn/openings and /learn/legends reference
// pages. These pages are server-rendered, unauthenticated, and indexable —
// they expose curated reference content (names, move orders, bios) while the
// interactive training product and the raw APIs stay auth-gated.

export interface EcoFamily {
  letter: string;
  name: string;
  description: string;
}

export const ECO_FAMILIES: EcoFamily[] = [
  {
    letter: "A",
    name: "Flank Openings",
    description:
      "characterized by moves like 1.c4, 1.Nf3, or 1.f4, aiming to control the center indirectly",
  },
  {
    letter: "B",
    name: "Semi-Open Games",
    description:
      "where Black responds to 1.e4 with something other than 1...e5, including the Sicilian Defense, Caro-Kann, and Pirc",
  },
  {
    letter: "C",
    name: "Open Games & French Defense",
    description:
      "beginning with 1.e4 e5 or 1.e4 e6, including the Italian Game, Ruy Lopez, and French Defense",
  },
  {
    letter: "D",
    name: "Closed & Semi-Closed Games",
    description:
      "arising from 1.d4 d5, including the Queen's Gambit, Slav Defense, and related systems",
  },
  {
    letter: "E",
    name: "Indian Defences",
    description:
      "where Black responds to 1.d4 with 1...Nf6, including the Nimzo-Indian, Queen's Indian, and King's Indian",
  },
];

export function getEcoFamily(letter: string): EcoFamily | undefined {
  return ECO_FAMILIES.find(
    (family) => family.letter === letter.toUpperCase(),
  );
}

/** "Sicilian Defense: Najdorf Variation" -> "sicilian-defense-najdorf-variation" */
export function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Opening slug: "<name-slug>-<eco>" e.g. "sicilian-defense-najdorf-variation-b90" */
export function buildOpeningSlug(name: string, eco: string): string {
  return `${slugifyName(name)}-${eco.toLowerCase()}`;
}

/** Splits an opening slug back into { nameSlug, eco } or null if malformed. */
export function parseOpeningSlug(
  slug: string,
): { nameSlug: string; eco: string } | null {
  const match = slug.match(/^(.+)-([a-e]\d{2})$/);
  if (!match || !match[1] || !match[2]) return null;
  return { nameSlug: match[1], eco: match[2].toUpperCase() };
}

export interface OpeningSummary {
  referenceId: string;
  eco: string;
  name: string;
  moveCount: number;
  pgn: string;
}

/**
 * All active openings deduplicated to one canonical line per (eco, name) —
 * the shortest line is treated as the main line. The database stores multiple
 * move orders under the same name; the public page shows one URL per named
 * opening and lists the other lines as variations.
 */
export async function getCanonicalOpenings(): Promise<OpeningSummary[]> {
  const openings = await prisma.opening.findMany({
    where: { isActive: true },
    select: {
      referenceId: true,
      eco: true,
      name: true,
      moveCount: true,
      pgn: true,
    },
    orderBy: [{ eco: "asc" }, { name: "asc" }, { moveCount: "asc" }],
  });

  const seen = new Map<string, OpeningSummary>();
  for (const opening of openings) {
    const key = `${opening.eco}::${opening.name}`;
    if (!seen.has(key)) seen.set(key, opening);
  }
  return [...seen.values()];
}

/**
 * Resolves a public opening slug to its canonical line plus alternative move
 * orders that share the same (eco, name). Returns null when nothing matches.
 */
export async function getOpeningBySlug(slug: string) {
  const parsed = parseOpeningSlug(slug);
  if (!parsed) return null;

  const candidates = await prisma.opening.findMany({
    where: { eco: parsed.eco, isActive: true },
    orderBy: [{ moveCount: "asc" }, { id: "asc" }],
  });

  const matching = candidates.filter(
    (opening) => slugifyName(opening.name) === parsed.nameSlug,
  );
  const canonical = matching[0];
  if (!canonical) return null;

  const siblingsByName = new Map<string, OpeningSummary>();
  for (const opening of candidates) {
    if (opening.name === canonical.name) continue;
    if (!siblingsByName.has(opening.name)) {
      siblingsByName.set(opening.name, {
        referenceId: opening.referenceId,
        eco: opening.eco,
        name: opening.name,
        moveCount: opening.moveCount,
        pgn: opening.pgn,
      });
    }
  }

  return {
    canonical,
    variations: matching.slice(1),
    siblings: [...siblingsByName.values()].slice(0, 12),
  };
}

export interface LegendSummary {
  referenceId: string;
  name: string;
  era: string;
  shortDescription: string;
  peakRating: number | null;
  nationality: string | null;
  birthYear: number | null;
  deathYear: number | null;
}

/** All publicly visible legends, ordered by name. */
export async function getVisibleLegends(): Promise<LegendSummary[]> {
  return prisma.legend.findMany({
    where: { isActive: true, isVisible: true },
    select: {
      referenceId: true,
      name: true,
      era: true,
      shortDescription: true,
      peakRating: true,
      nationality: true,
      birthYear: true,
      deathYear: true,
    },
    orderBy: { name: "asc" },
  });
}

/** Resolves a legend slug ("magnus-carlsen") to the full record, or null. */
export async function getLegendBySlug(slug: string) {
  const legends = await prisma.legend.findMany({
    where: { isActive: true, isVisible: true },
  });
  return legends.find((legend) => slugifyName(legend.name) === slug) ?? null;
}
