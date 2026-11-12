// The share preview card (phase-03 plan §4.3; V3RvShare figure): the wordmark and "Game review", the board at the key
// moment (passed in: P2's Board on the share screen, a server-rendered MiniBoard on the public page), the names with
// §11.3 masking, "Rapid 10+0 · 0–1", the accuracy and the key-moment caption. While the link is generating the board
// carries a "GENERATING…" status overlay. No VERIFIED tag: template text is not verifier output (P3-D16).
import type { SharePreviewModel } from "./preview";
import { SHARE_COPY } from "./copy";

export function SharePreviewCard({
  model,
  board,
  generating = false,
}: {
  model: SharePreviewModel;
  board: React.ReactNode;
  generating?: boolean;
}) {
  return (
    <figure className="sh-card" data-testid="share-preview" aria-label={`${SHARE_COPY.cardLabel}: ${model.title}`}>
      <div className="sh-card__top">
        <span className="sh-serif sh-card__word">{SHARE_COPY.wordmark}</span>
        <span className="sh-lbl">{SHARE_COPY.cardLabel}</span>
      </div>
      <div className="sh-card__body">
        <div className="sh-card__board">
          {board}
          {generating ? (
            <div className="sh-card__gen" role="status" data-testid="share-generating">
              <span className="sh-spin" aria-hidden="true" />
              <span className="sh-mono">{SHARE_COPY.generating}</span>
            </div>
          ) : null}
        </div>
        <figcaption className="sh-card__facts">
          <span className="sh-card__title" data-testid="share-preview-title">
            {model.title}
          </span>
          <span className="sh-mono sh-card__meta">{model.meta}</span>
          {model.accuracy !== null ? (
            <>
              <span className="sh-mono sh-card__acc">{model.accuracy}</span>
              <span className="sh-lbl">{SHARE_COPY.accuracy}</span>
            </>
          ) : null}
          {model.caption ? <span className="sh-card__cap">{model.caption}</span> : null}
        </figcaption>
      </div>
    </figure>
  );
}
