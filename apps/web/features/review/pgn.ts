// Download PGN (phase-03 plan §5.2, P3-D18): the annotated PGN is built in the browser from the cached payload with
// `buildAnnotatedPgn` (CA, the same builder as A8), so the download costs no request. The file name is A8's
// `annotatedPgnFilename()`, from the zod-free contract module (AP-12).

import { annotatedPgnFilename } from "@repo/contracts/http/plain";
import type { ReviewDTO } from "@repo/contracts/http/review";
import { buildAnnotatedPgn } from "@repo/chess-analysis/pgn";

/** `replaychess-<white>-vs-<black>-<yyyy-mm-dd>.pgn` with names reduced to [a-z0-9_-] (the A8 file name). */
export const pgnFilename = annotatedPgnFilename;

/** The PGN text and its file name for a review payload. */
export function annotatedPgnOf(dto: ReviewDTO, site: string): { text: string; filename: string } {
  const text = buildAnnotatedPgn(dto, { site });
  const playedAt = new Date(dto.game.playedAt);
  return { text, filename: pgnFilename(dto.players.w.name, dto.players.b.name, Number.isNaN(playedAt.getTime()) ? new Date() : playedAt) };
}

/** Saves the file through a Blob URL (no network). */
export function downloadPgn(dto: ReviewDTO): void {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || window.location.origin;
  const { text, filename } = annotatedPgnOf(dto, site);
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-chess-pgn" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
