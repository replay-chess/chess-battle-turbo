// The social cards as `next/og` elements (phase-03 plan §5.5): the generic Replay Chess card (the P0 `/og` design,
// also what a revoked, expired or unknown share's image returns) and the share card (1200×630: the board at the key
// moment drawn as 64 squares, the masked names, the result, the accuracy and the caption). satori renders flexbox and
// inline styles only, so the board is absolutely placed squares and the arrow an inline SVG polygon. Image sources
// must be absolute URLs (satori fetches them), hence the `origin` argument.
import type { ReactElement } from "react";
import {
  ALL_SQUARES,
  GENERIC,
  OG_DOMAIN,
  OG_WORDMARK,
  PAPER,
  arrowPolygon,
  genericTitleSize,
  isDarkSquare,
  placementPieces,
  publicAsset,
  squareOrigin,
  type GenericCardInput,
} from "./theme";

/** The generic card (black, white serif-less title, label chip, wordmark and domain). */
export function genericCard(input: GenericCardInput): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: GENERIC.bg,
        padding: "60px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", opacity: 0.04, backgroundImage: GENERIC.grid, backgroundSize: "60px 60px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {input.label ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: `1px solid ${GENERIC.labelBorder}`,
              padding: "8px 16px",
              fontSize: "16px",
              color: GENERIC.label,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ fontSize: "20px" }}>{input.icon}</span>
            {input.label}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ fontSize: genericTitleSize(input.title), fontWeight: 400, color: GENERIC.text, lineHeight: 1.1, maxWidth: "900px" }}>
          {input.title}
        </div>
        {input.subtitle ? (
          <div style={{ fontSize: 24, color: GENERIC.soft, maxWidth: "800px", lineHeight: 1.4 }}>{input.subtitle}</div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              backgroundColor: GENERIC.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
            }}
          >
            ♟
          </div>
          <span style={{ fontSize: "24px", color: GENERIC.text, fontWeight: 400 }}>{OG_WORDMARK}</span>
        </div>
        <span style={{ fontSize: "16px", color: GENERIC.faint, letterSpacing: "0.1em" }}>{OG_DOMAIN}</span>
      </div>
    </div>
  );
}

export interface ShareCardInput {
  title: string;
  meta: string;
  accuracy: number | null;
  caption: string | null;
  /** The board at the card's moment. */
  board: {
    fen: string;
    orientation: "w" | "b";
    last: [string, string] | null;
    arrow: [string, string] | null;
    /** `/board_icons/svg/<name>.svg` of the moved piece's grade, or null. */
    badge: { sq: string; icon: string } | null;
  };
  label: string;
}

const BOARD = 510;

function cardBoard(input: ShareCardInput["board"], origin: string): ReactElement {
  const pieces = placementPieces(input.fen);
  const s = BOARD / 8;
  const last = new Set(input.last ?? []);
  return (
    <div style={{ display: "flex", position: "relative", width: BOARD, height: BOARD, flex: "none" }}>
      {ALL_SQUARES.map((sq) => {
        const { col, row } = squareOrigin(sq, input.orientation);
        const piece = pieces.get(sq);
        return (
          <div
            key={sq}
            style={{
              position: "absolute",
              left: col * s,
              top: row * s,
              width: s,
              height: s,
              display: "flex",
              backgroundColor: isDarkSquare(sq) ? PAPER.boardDark : PAPER.boardLight,
            }}
          >
            {last.has(sq) ? <div style={{ position: "absolute", left: 0, top: 0, width: s, height: s, backgroundColor: PAPER.boardLast }} /> : null}
            {piece ? (
              // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> only
              <img src={publicAsset(origin, `/chess-icons/${piece}.png`)} width={s * 0.9} height={s * 0.9} alt="" style={{ margin: s * 0.05 }} />
            ) : null}
          </div>
        );
      })}
      {input.arrow ? (
        <svg width={BOARD} height={BOARD} viewBox={`0 0 ${BOARD} ${BOARD}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <polygon points={arrowPolygon(input.arrow[0], input.arrow[1], input.orientation, BOARD)} fill={PAPER.arrow} fillOpacity={0.85} />
        </svg>
      ) : null}
      {input.badge
        ? (() => {
            const { col, row } = squareOrigin(input.badge.sq, input.orientation);
            const size = s * 0.42;
            const left = Math.min(BOARD - size, col * s + s - size * 0.75);
            const top = Math.max(0, row * s - size * 0.25);
            return (
              // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> only
              <img src={publicAsset(origin, input.badge.icon)} width={size} height={size} alt="" style={{ position: "absolute", left, top }} />
            );
          })()
        : null}
    </div>
  );
}

/** The share image: the board left, the facts right, the wordmark and the domain. */
export function shareCard(input: ShareCardInput, origin: string): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: PAPER.bg,
        padding: "60px",
        gap: "56px",
        fontFamily: "sans-serif",
        color: PAPER.ink,
      }}
    >
      {cardBoard(input.board, origin)}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 34 }}>{OG_WORDMARK}</span>
            <span style={{ fontSize: 16, letterSpacing: "0.12em", textTransform: "uppercase", color: PAPER.soft }}>{input.label}</span>
          </div>
          <div style={{ height: 1, backgroundColor: PAPER.border, display: "flex" }} />
          <span style={{ fontSize: input.title.length > 32 ? 32 : 40, lineHeight: 1.15, fontWeight: 500 }}>{input.title}</span>
          <span style={{ fontSize: 22, color: PAPER.soft }}>{input.meta}</span>
        </div>
        {input.accuracy !== null ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 96, lineHeight: 1 }}>{input.accuracy}</span>
            <span style={{ fontSize: 16, letterSpacing: "0.12em", textTransform: "uppercase", color: PAPER.soft }}>Accuracy</span>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {input.caption ? <span style={{ fontSize: 24, lineHeight: 1.35 }}>{input.caption}</span> : null}
          <span style={{ fontSize: 16, letterSpacing: "0.1em", color: PAPER.soft }}>{OG_DOMAIN}</span>
        </div>
      </div>
    </div>
  );
}
