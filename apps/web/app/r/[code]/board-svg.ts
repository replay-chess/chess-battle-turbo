// The public share page's board as SVG markup (phase-03 plan §4.4: "a server-rendered SVG MiniBoard, no board JS"):
// the warm article-board squares, the last move, a check ring, the moved piece's grade badge and the engine's arrow
// on the key moment. The server renders the opening frame with it, and the page's island (island.ts) steps through
// the others with the very same function: html.ts inlines `shareBoardSvg.toString()` into the island script, so this
// function must stay self-contained (no imports, no module-level constants, nothing the minifier could hoist).
// Geometry equals lib/og/theme.ts (the share image), checked by board-svg.test.ts.

/** One frame of the board (share-view.ts ShareFrame, short keys as the island's data carries them). */
export interface BoardFrame {
  /** FEN placement field. */
  p: string;
  /** From/to of the move that reached it. */
  l: [string, string] | null;
  /** The move's grade key ("blunder") or null. */
  q: string | null;
  /** The king in check, or null. */
  c: string | null;
}

/** SVG markup of one frame. `label` is the board's accessible name (escaped here). */
export function shareBoardSvg(
  f: BoardFrame,
  orientation: "w" | "b",
  arrow: [string, string] | null,
  label: string,
): string {
  const SIZE = 800;
  const SQ = 100;
  const FILES = "abcdefgh";
  const ICONS: Record<string, string> = {
    brilliant: "brilliant",
    great: "great_find",
    best: "best",
    excellent: "excellent",
    good: "good",
    book: "book",
    forced: "forced",
    inaccuracy: "inaccuracy",
    mistake: "mistake",
    miss: "missed_win",
    blunder: "blunder",
  };
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const origin = (sq: string) => {
    const file = FILES.indexOf(sq.charAt(0));
    const rank = Number(sq.charAt(1)) - 1;
    return orientation === "w" ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
  };
  const centre = (sq: string) => {
    const o = origin(sq);
    return { x: o.col * SQ + SQ / 2, y: o.row * SQ + SQ / 2 };
  };
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const out: string[] = [
    `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${esc(label)}" class="board-svg" data-testid="share-board" shape-rendering="crispEdges">`,
  ];
  for (let r = 8; r >= 1; r--) {
    for (let fi = 0; fi < 8; fi++) {
      const sq = `${FILES.charAt(fi)}${r}`;
      const o = origin(sq);
      const dark = (fi + r - 1) % 2 === 0;
      out.push(`<rect x="${o.col * SQ}" y="${o.row * SQ}" width="${SQ}" height="${SQ}" style="fill:var(--article-board-${dark ? "dark" : "light"})"/>`);
    }
  }
  if (f.l) {
    for (const sq of f.l) {
      const o = origin(sq);
      out.push(`<rect x="${o.col * SQ}" y="${o.row * SQ}" width="${SQ}" height="${SQ}" style="fill:var(--article-board-last)"/>`);
    }
  }
  if (f.c) {
    const c = centre(f.c);
    out.push(
      `<circle cx="${c.x}" cy="${c.y}" r="${n(SQ * 0.46)}" fill="none" stroke="var(--cb-bad)" stroke-width="${n(SQ * 0.06)}" shape-rendering="geometricPrecision"/>`,
    );
  }
  const ranks = f.p.split("/");
  if (ranks.length === 8) {
    ranks.forEach((rank, i) => {
      let file = 0;
      for (const ch of rank) {
        if (ch >= "1" && ch <= "8") {
          file += Number(ch);
          continue;
        }
        const lower = ch.toLowerCase();
        if (!"kqrbnp".includes(lower) || file > 7) return;
        const sq = `${FILES.charAt(file)}${8 - i}`;
        const o = origin(sq);
        const piece = `${ch === lower ? "b" : "w"}${lower}`;
        out.push(
          `<image href="/chess-icons/${piece}.png" x="${n(o.col * SQ + SQ * 0.05)}" y="${n(o.row * SQ + SQ * 0.05)}" width="${n(SQ * 0.9)}" height="${n(SQ * 0.9)}"/>`,
        );
        file++;
      }
    });
  }
  if (arrow) {
    const a = centre(arrow[0]);
    const b = centre(arrow[1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const shaft = SIZE / 64;
    const head = SIZE / 24;
    const tipX = b.x - ux * (SIZE / 40);
    const tipY = b.y - uy * (SIZE / 40);
    const baseX = tipX - ux * head * 1.4;
    const baseY = tipY - uy * head * 1.4;
    const nx = -uy;
    const ny = ux;
    const pts = [
      [a.x + nx * shaft, a.y + ny * shaft],
      [baseX + nx * shaft, baseY + ny * shaft],
      [baseX + nx * head, baseY + ny * head],
      [tipX, tipY],
      [baseX - nx * head, baseY - ny * head],
      [baseX - nx * shaft, baseY - ny * shaft],
      [a.x - nx * shaft, a.y - ny * shaft],
    ];
    out.push(
      `<polygon points="${pts.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ")}" fill="var(--mq-best)" fill-opacity="0.85" shape-rendering="geometricPrecision" data-testid="share-arrow"/>`,
    );
  }
  if (f.l && f.q) {
    const o = origin(f.l[1]);
    const s = SQ * 0.4;
    const x = Math.min(SIZE - s, o.col * SQ + SQ - s * 0.75);
    const y = Math.max(0, o.row * SQ - s * 0.25);
    const icon = ICONS[f.q];
    out.push(
      icon
        ? `<image href="/board_icons/svg/${icon}.svg" x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" data-testid="share-badge" data-q="${esc(f.q)}"/>`
        : `<g data-testid="share-badge" data-q="${esc(f.q)}" shape-rendering="geometricPrecision"><circle cx="${n(x + s / 2)}" cy="${n(y + s / 2)}" r="${n(s / 2)}" style="fill:var(--mq-${esc(f.q)})"/><text x="${n(x + s / 2)}" y="${n(y + s * 0.66)}" text-anchor="middle" font-size="${n(s * 0.48)}" font-weight="700" fill="#fff" font-family="ui-monospace, monospace">!?</text></g>`,
    );
  }
  out.push("</svg>");
  return out.join("");
}
