// Social-card theme (phase-03 plan §3.2 `app/og/route.tsx` row, §5.5): the colours, sizes and pure helpers the
// generic card (`/og`) and the share image (`/r/<code>/og`) both use. `next/og` (satori) renders inline styles only,
// so every value here is a literal, mirrored from the design system tokens (DS tokens.json; app/globals.css :root):
// paper #faf9f6, ink #1a1a1a, accent #3d3229, the warm article-board squares and the move-quality colours.
// No React and no Next imports: the card elements live in ./cards.tsx; this file is unit-tested in plain Node.

/** The 1.91:1 card every network unfurls (Open Graph, X `summary_large_image`). */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The generic card's palette (unchanged from the P0 `/og` design: black, white text, a faint grid). */
export const GENERIC = {
  bg: "#000000",
  text: "#ffffff",
  soft: "rgba(255,255,255,0.4)",
  label: "rgba(255,255,255,0.6)",
  labelBorder: "rgba(255,255,255,0.2)",
  faint: "rgba(255,255,255,0.3)",
  grid: "linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)",
} as const;

/** The share card's palette (DS light theme). */
export const PAPER = {
  bg: "#faf9f6",
  surface: "#ffffff",
  ink: "#1a1a1a",
  soft: "rgba(0,0,0,0.62)",
  border: "rgba(0,0,0,0.12)",
  accent: "#3d3229",
  boardLight: "#e9e2d4",
  boardDark: "#8f7865",
  boardLast: "rgba(225,184,74,0.55)",
  /** The engine's move on a key moment (`mq-best`, the review's reveal arrow). */
  arrow: "#7d9d3e",
} as const;

/** The domain printed on every card. */
export const OG_DOMAIN = "playchess.tech";
export const OG_WORDMARK = "ReplayChess";

/** The generic card's labels by `?type=` (the P0 `/og` route). */
export const GENERIC_LABELS: Record<string, { label: string; icon: string }> = {
  legend: { label: "Chess Legend", icon: "♚" },
  opening: { label: "Chess Opening", icon: "♞" },
  blog: { label: "Blog", icon: "✦" },
  profile: { label: "Player Profile", icon: "♟" },
};

/** What a revoked, expired or unknown share's image shows: the generic card, with no names and no board. */
export const SHARE_FALLBACK_CARD: GenericCardInput = {
  title: OG_WORDMARK,
  subtitle: "Every game graded move by move, then turned into a lesson.",
  label: "",
  icon: "♟",
};

export interface GenericCardInput {
  title: string;
  subtitle: string;
  /** Empty for no label chip. */
  label: string;
  icon: string;
}

/** The generic card's text from `/og` query values: length caps and the `type` label (unknown type → no chip). */
export function genericCardInput(params: { title?: string | null; subtitle?: string | null; type?: string | null }): GenericCardInput {
  const meta = params.type ? GENERIC_LABELS[params.type] : undefined;
  return {
    title: (params.title || OG_WORDMARK).slice(0, 200),
    subtitle: (params.subtitle || "").slice(0, 300),
    label: meta?.label ?? "",
    icon: meta?.icon ?? "♟",
  };
}

/** The title's size: long titles step down so they stay within two lines. */
export function genericTitleSize(title: string): number {
  return title.length > 40 ? 48 : 64;
}

// ── Board geometry for the share image (64 absolutely placed squares; satori has no CSS grid) ─────────────────────

export const FILES = "abcdefgh";

/** Top-left of a square in board units (0..7), White at the bottom unless `orientation` is "b". */
export function squareOrigin(sq: string, orientation: "w" | "b"): { col: number; row: number } {
  const file = FILES.indexOf(sq.charAt(0));
  const rank = Number(sq.charAt(1)) - 1;
  return orientation === "w" ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

export function isDarkSquare(sq: string): boolean {
  const file = FILES.indexOf(sq.charAt(0));
  const rank = Number(sq.charAt(1)) - 1;
  return (file + rank) % 2 === 0;
}

/** Every square in FEN order (a8 … h1). */
export const ALL_SQUARES: readonly string[] = (() => {
  const out: string[] = [];
  for (let r = 8; r >= 1; r--) for (const f of FILES) out.push(`${f}${r}`);
  return out;
})();

/** The pieces of a FEN's placement field as square → "wk" | "bp" … (the /chess-icons file names). */
export function placementPieces(fen: string): Map<string, string> {
  const out = new Map<string, string>();
  const placement = fen.split(" ")[0] ?? "";
  const ranks = placement.split("/");
  if (ranks.length !== 8) return out;
  ranks.forEach((rank, i) => {
    let file = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!"kqrbnp".includes(lower) || file > 7) return;
      const color = ch === lower ? "b" : "w";
      out.set(`${FILES.charAt(file)}${8 - i}`, `${color}${lower}`);
      file += 1;
    }
  });
  return out;
}

/** An absolute URL for an image under /public: satori fetches images itself, so it needs the origin. */
export function publicAsset(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Centre of a square in pixels on a board of `size` px. */
export function squareCentre(sq: string, orientation: "w" | "b", size: number): { x: number; y: number } {
  const { col, row } = squareOrigin(sq, orientation);
  const s = size / 8;
  return { x: col * s + s / 2, y: row * s + s / 2 };
}

/**
 * The arrow polygon from one square to another on a board of `size` px: a shaft of `size/64` half-width and a head
 * of `size/24`, stopping short of the target centre so the head points at the piece (the board's ArrowLayer shape).
 */
export function arrowPolygon(from: string, to: string, orientation: "w" | "b", size: number): string {
  const a = squareCentre(from, orientation, size);
  const b = squareCentre(to, orientation, size);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const shaft = size / 64;
  const head = size / 24;
  const tipX = b.x - ux * (size / 40);
  const tipY = b.y - uy * (size / 40);
  const baseX = tipX - ux * head * 1.4;
  const baseY = tipY - uy * head * 1.4;
  const nx = -uy;
  const ny = ux;
  const pts: [number, number][] = [
    [a.x + nx * shaft, a.y + ny * shaft],
    [baseX + nx * shaft, baseY + ny * shaft],
    [baseX + nx * head, baseY + ny * head],
    [tipX, tipY],
    [baseX - nx * head, baseY - ny * head],
    [baseX - nx * shaft, baseY - ny * shaft],
    [a.x - nx * shaft, a.y - ny * shaft],
  ];
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
