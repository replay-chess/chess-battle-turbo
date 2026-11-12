"use client";

// Share analysis (phase-03 plan §4.3, §5.4; board V3RvShare): the preview card on the left, the controls on the right
// (one column on phones and iPad portrait, with Copy Link pinned at the bottom and Post to X as the system share).
//
// Data: the review payload and the viewer's live link from the caches the RSC seeded (`qk.review.detail`,
// `qk.review.share` from getActiveShare). The page never creates on GET; when there is no live link this screen sends
// A10 once on mount (lib/api/mutations/share: Idempotency-Key from sessionStorage `rc:share:<ref>`, so a reload or a
// double effect replays the same answer, and an identical live link is reused), then warms the image: `ready` when it
// loads, or after 2 s. Toggling the username is optimistic (the preview re-renders locally) → A11
// PATCH → the new image URL; Stop Sharing is optimistic (`revoked`) → DELETE; both roll back with a toast on error.
// Copy Link, Post to X and Copy PGN (built in the browser, P3-D18) are local only. A 429 shows the wait inline.
// In the /dev/ui demo nothing is sent: the states are seeded and the actions change local state only.

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, Share as ShareIcon, Upload } from "lucide-react";
import type { ReviewDTO } from "@repo/contracts/http/review";
import type { ShareDTO, ShareFrom } from "@repo/contracts/http/share";
import { Board } from "@/components/board/Board";
import type { Sq } from "@/components/board/types";
import { Banner } from "@/components/ui/banner";
import { CheckboxRow } from "@/components/ui/checkbox";
import { qk } from "@/lib/api/keys";
import { ApiError, reactToApiError } from "@/lib/api/errors";
import {
  createShareRequest,
  forgetShareIdempotencyKey,
  revokeShareRequest,
  shareIdempotencyKey,
  updateShareRequest,
  writeShareCaches,
} from "@/lib/api/mutations/share";
import { reviewQuery } from "@/lib/api/queries/review";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";
import { CONTROL_SELECTOR } from "@/features/review/keys/hotkeys";
import { reviewPlies } from "@/features/review/model";
import { annotatedPgnOf } from "@/features/review/pgn";
import { trackReview } from "@/features/review/telemetry";
import { SHARE_COPY } from "./copy";
import { sharePreviewFromReview } from "./preview";
import { SharePreviewCard } from "./SharePreviewCard";
import { controlsFor, displayLink, imageDownloadUrl, initialShareState, shareReducer, waitLabel, xIntentUrl, type ShareState } from "./state";
import "./share.css";

/** `ready` at the latest this long after the link exists, even if the image is still rendering (§4.3). */
export const IMAGE_WARM_MAX_MS = 2_000;
const COPIED_MS = 2_000;
const NO_DESTS = (): Sq[] => [];
const NO_MOVE = (): void => undefined;

export type ShareDemo = { state: "generating" | "ready" | "copied" | "error" | "rate_limited" | "revoked"; share: ShareDTO };

function demoState(demo: ShareDemo): ShareState {
  const base = initialShareState(demo.share, demo.share.showUsername);
  switch (demo.state) {
    case "generating":
      return { ...base, status: "generating", share: null };
    case "ready":
      return base;
    case "copied":
      return { ...base, copied: true };
    case "error":
      return { ...base, status: "error", share: null };
    case "rate_limited":
      return { ...base, status: "rate_limited", share: null, retryAfterSec: 3 * 3_600 };
    case "revoked":
      return { ...base, status: "revoked" };
  }
}

const noSubscribe = () => () => {};

/** The system share sheet replaces Post to X on touch devices that have one (iPad, phones); false on the server. */
function useSystemShare(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => (window.matchMedia?.(COARSE_MQ).matches ?? false) && typeof navigator.share === "function",
    () => false,
  );
}

export function ShareScreen({ refId, from, demo }: { refId: string; from: ShareFrom; demo?: ShareDemo }) {
  const qc = useQueryClient();
  const detail = useQuery({ ...reviewQuery(refId), enabled: !demo });
  const dto = detail.data as ReviewDTO;
  const cached = demo ? null : (qc.getQueryData<ShareDTO>(qk.review.share(refId)) ?? null);
  const [state, dispatch] = useReducer(shareReducer, null, () => (demo ? demoState(demo) : initialShareState(cached, dto.share?.showUsername ?? true)));
  const phone = useSystemShare();
  const controls = controlsFor(state);
  const props = { from, show_username: state.showUsername };

  // ── telemetry: opened once ──
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackReview("share_opened", { from });
  }, [from]);

  // ── create (A10) once on mount, and again from Try Again / Create a New Link ──
  const created = useRef(false);
  const create = () => {
    if (demo) {
      dispatch({ type: "create" });
      setTimeout(() => dispatch({ type: "created", share: { ...demo.share, showUsername: state.showUsername } }), 600);
      return;
    }
    dispatch({ type: "create" });
    createShareRequest(refId, { showUsername: state.showUsername, from }, shareIdempotencyKey(refId))
      .then((share) => {
        writeShareCaches(qc, refId, share);
        dispatch({ type: "created", share });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "rate_limited") {
          dispatch({ type: "rate_limited", retryAfterSec: err.retryAfterSec ?? 60 });
          return;
        }
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) reactToApiError(err, { kind: "mutation", queryClient: qc, meta: { errorUi: "inline" } });
        dispatch({ type: "failed" });
      });
  };
  useEffect(() => {
    if (demo || created.current || state.share) return;
    created.current = true;
    create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount (the key makes a replay safe)
  }, []);

  // ── warm the image: ready on load, or after 2 s ──
  const imageUrl = state.share?.imageUrl ?? null;
  useEffect(() => {
    if (state.status !== "generating" || !imageUrl) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dispatch({ type: "image_ready" });
    };
    const t = setTimeout(finish, demo ? 1_000 : IMAGE_WARM_MAX_MS);
    const img = new Image();
    img.onload = finish;
    img.onerror = finish;
    if (!demo) img.src = imageUrl;
    return () => {
      done = true;
      clearTimeout(t);
    };
  }, [state.status, imageUrl, demo]);

  // ── the 429 wait counts down; the primary comes back when it ends ──
  useEffect(() => {
    if (state.status !== "rate_limited" || state.retryAfterSec === null || demo) return;
    const t = setTimeout(() => dispatch({ type: "failed" }), state.retryAfterSec * 1_000);
    return () => clearTimeout(t);
  }, [state.status, state.retryAfterSec, demo]);

  // ── actions ──
  const copyLink = async () => {
    if (!state.share || !controls.link) return;
    try {
      await navigator.clipboard.writeText(state.share.url);
      dispatch({ type: "copied" });
      trackReview("share_link_copied", props);
      setTimeout(() => dispatch({ type: "copy_reset" }), COPIED_MS);
    } catch {
      toast.error(SHARE_COPY.copyFailed, { id: "share-copy" });
    }
  };

  const postToX = async () => {
    if (!state.share || !controls.link) return;
    trackReview("share_posted_x", props);
    if (phone) {
      try {
        await navigator.share({ title: SHARE_COPY.title, text: SHARE_COPY.xText, url: state.share.url });
      } catch {
        // Dismissed or unsupported: copying the link is the fallback.
        void copyLink();
      }
      return;
    }
    window.open(xIntentUrl(SHARE_COPY.xText, state.share.url), "_blank", "noopener,noreferrer");
  };

  const copyPgn = async () => {
    if (!controls.pgn) return;
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || window.location.origin;
    try {
      await navigator.clipboard.writeText(annotatedPgnOf(dto, site).text);
      trackReview("share_pgn_copied", props);
      toast.success(SHARE_COPY.pgnCopied, { id: "share-pgn" });
    } catch {
      toast.error(SHARE_COPY.copyFailed, { id: "share-pgn" });
    }
  };

  const toggleUsername = (next: boolean) => {
    if (!state.share || !controls.toggle) return;
    const prev = state.showUsername;
    dispatch({ type: "toggle", showUsername: next });
    trackReview("share_username_toggled", { from, show_username: next });
    if (demo) {
      dispatch({ type: "toggled", share: { ...state.share, showUsername: next } });
      return;
    }
    updateShareRequest(state.share.code, next)
      .then((share) => {
        writeShareCaches(qc, refId, share);
        dispatch({ type: "toggled", share });
      })
      .catch(() => {
        dispatch({ type: "toggle_failed", showUsername: prev });
        toast.error(SHARE_COPY.toggleFailed, { id: "share-toggle" });
      });
  };

  const stopSharing = () => {
    if (!state.share || !controls.stop) return;
    const code = state.share.code;
    dispatch({ type: "revoke" });
    trackReview("share_revoked", props);
    if (demo) return;
    revokeShareRequest(code)
      .then(() => {
        writeShareCaches(qc, refId, null);
        // Create a New Link must make a new link, not replay the revoked one.
        forgetShareIdempotencyKey(refId);
      })
      .catch(() => {
        dispatch({ type: "revoke_failed" });
        toast.error(SHARE_COPY.revokeFailed, { id: "share-revoke" });
      });
  };

  // ── Enter = Copy Link (outside controls and fields; fine pointer; single-key shortcuts on) ──
  const copyRef = useRef(copyLink);
  useEffect(() => {
    copyRef.current = copyLink;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target) || document.querySelector(MODAL_OPEN_SELECTOR)) return;
      if (e.target instanceof Element && e.target.closest(CONTROL_SELECTOR)) return;
      if (window.matchMedia(COARSE_MQ).matches || !singleKeyEnabledNow()) return;
      e.preventDefault();
      void copyRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── the preview card's board ──
  const model = sharePreviewFromReview(dto, state.showUsername);
  const plies = reviewPlies(dto);
  const k = model.board ? Math.min(model.board.ply + 1, plies.fens.length - 1) : plies.fens.length - 1;
  const fen = plies.fens[k] ?? dto.game.startFen;
  // A picture of the shared position (`thumb`: role="img", no square buttons or tab stops). An interactive board here
  // put 64 tiny tap targets and 64 tab stops into a preview (regression: share-preview-board).
  const board = (
    <Board
      thumb
      fen={fen}
      orientation={dto.you}
      mover={null}
      dests={NO_DESTS}
      onMove={NO_MOVE}
      lastMove={model.board?.lastMove ? (model.board.lastMove as [Sq, Sq]) : null}
      arrows={model.board?.arrow ? [{ from: model.board.arrow[0] as Sq, to: model.board.arrow[1] as Sq, color: "mq-best" }] : []}
      badges={model.board?.badge ? [{ sq: model.board.badge.sq as Sq, kind: model.board.badge.kind, label: model.boardLabel }] : []}
      coordinates={false}
      label={model.boardLabel}
      testId="share-board"
    />
  );

  const link = state.share && state.status !== "revoked" ? displayLink(state.share.url) : "";
  const disabled = !controls.link;

  return (
    <div className="sh" data-rc-lock="" data-testid="share-screen" data-state={state.copied ? "copied" : state.status}>
      <div className="sh__grid">
        <div className="sh__preview">
          <SharePreviewCard model={model} board={board} generating={state.status === "generating"} />
        </div>

        <div className="sh__controls">
          <span className="sh-lbl">{SHARE_COPY.eyebrow}</span>
          <h1 className="sh-h1">{SHARE_COPY.title}</h1>
          <p className="sh-p sh-explain">{SHARE_COPY.explainer}</p>

          {state.status === "error" ? (
            <Banner
              tone="bad"
              layout="note"
              data-testid="share-error"
              action={
                <button type="button" className="sh-btn-s" onClick={create} data-testid="share-try-again">
                  {SHARE_COPY.tryAgain}
                </button>
              }
            >
              {SHARE_COPY.errorLine}
            </Banner>
          ) : null}
          {state.status === "rate_limited" && state.retryAfterSec !== null ? (
            <p className="sh-wait" role="status" data-testid="share-rate-limited">
              {SHARE_COPY.rateLimited(waitLabel(state.retryAfterSec))}
            </p>
          ) : null}
          {state.status === "revoked" ? (
            <div className="sh-revoked" role="status" data-testid="share-revoked">
              <p className="sh-p">{SHARE_COPY.revokedLine}</p>
              <button type="button" className="sh-btn-p" onClick={create} data-testid="share-create-new">
                {SHARE_COPY.createNew}
              </button>
            </div>
          ) : (
            <>
              <div className="sh-linkrow">
                <label htmlFor="sh-link" className="sh-vh">
                  {SHARE_COPY.linkLabel}
                </label>
                <input id="sh-link" className="sh-inp sh-mono" readOnly value={link} placeholder={state.status === "generating" ? SHARE_COPY.generating : ""} data-testid="share-link" />
                <button type="button" className="sh-btn-p sh-copy" onClick={copyLink} disabled={disabled} data-testid="share-copy">
                  <Copy aria-hidden="true" size={16} />
                  {state.copied ? SHARE_COPY.linkCopied : SHARE_COPY.copyLink}
                </button>
              </div>
              <p className="sh-copied" role="status" data-testid="share-copied">
                {state.copied ? SHARE_COPY.copiedStatus : ""}
              </p>
              <div className="sh-rows">
                {state.share && controls.link ? (
                  <a
                    className="sh-row"
                    href={imageDownloadUrl(state.share.imageUrl)}
                    download
                    onClick={(e) => {
                      if (demo) e.preventDefault();
                      trackReview("share_image_downloaded", props);
                    }}
                    data-testid="share-download"
                  >
                    <Download aria-hidden="true" size={18} />
                    <span className="sh-row__text">
                      {SHARE_COPY.downloadImage}
                      <span className="sh-row__sub">{SHARE_COPY.downloadImageSub}</span>
                    </span>
                  </a>
                ) : (
                  <button type="button" className="sh-row" disabled data-testid="share-download">
                    <Download aria-hidden="true" size={18} />
                    <span className="sh-row__text">
                      {SHARE_COPY.downloadImage}
                      <span className="sh-row__sub">{SHARE_COPY.downloadImageSub}</span>
                    </span>
                  </button>
                )}
                <button type="button" className="sh-row" onClick={postToX} disabled={disabled} data-testid="share-post-x">
                  {phone ? <ShareIcon aria-hidden="true" size={18} /> : <Upload aria-hidden="true" size={18} />}
                  <span className="sh-row__text">{phone ? SHARE_COPY.shareNative : SHARE_COPY.postToX}</span>
                </button>
                <button type="button" className="sh-row" onClick={copyPgn} disabled={!controls.pgn} data-testid="share-copy-pgn">
                  <Copy aria-hidden="true" size={18} />
                  <span className="sh-row__text">{SHARE_COPY.copyPgn}</span>
                </button>
              </div>
              <CheckboxRow
                label={SHARE_COPY.showUsername}
                checked={state.showUsername}
                onCheckedChange={toggleUsername}
                disabled={!controls.toggle}
                data-testid="share-show-username"
              />
              <button type="button" className="sh-btn-t sh-stop" onClick={stopSharing} disabled={!controls.stop} data-testid="share-stop">
                {SHARE_COPY.stopSharing}
              </button>
            </>
          )}
          <Link className="sh-btn-t" href={demo ? "/dev/ui/review?state=summary" : `/review/${encodeURIComponent(refId)}`} data-testid="share-back">
            {SHARE_COPY.backToReview}
          </Link>
        </div>
      </div>

      {state.status !== "revoked" ? (
        <div className="sh__bar">
          <button type="button" className="sh-btn-p" onClick={copyLink} disabled={disabled} data-testid="share-copy-bar">
            <Copy aria-hidden="true" size={16} />
            {state.copied ? SHARE_COPY.linkCopied : SHARE_COPY.copyLink}
          </button>
        </div>
      ) : null}
    </div>
  );
}
