// The share screen's state machine (phase-03 plan §4.3 "States"; V3RvShare `generating | ready` + the plan's
// `copied`, `error`, `rate_limited`, `revoked`). Pure and unit-tested; the screen dispatches into it.
import type { ShareDTO } from "@repo/contracts/http/share";

export type ShareStatus = "generating" | "ready" | "error" | "rate_limited" | "revoked";

export interface ShareState {
  status: ShareStatus;
  share: ShareDTO | null;
  /** The checkbox (optimistic: it moves before A11 answers). */
  showUsername: boolean;
  /** "Link Copied" + the COPIED status for 2 s. */
  copied: boolean;
  /** A10's 429 wait. */
  retryAfterSec: number | null;
  /** A request is in flight (create, toggle, revoke): the controls it affects are disabled. */
  busy: boolean;
}

export type ShareAction =
  | { type: "create" }
  | { type: "created"; share: ShareDTO }
  | { type: "image_ready" }
  | { type: "failed" }
  | { type: "rate_limited"; retryAfterSec: number }
  | { type: "copied" }
  | { type: "copy_reset" }
  | { type: "toggle"; showUsername: boolean }
  | { type: "toggled"; share: ShareDTO }
  | { type: "toggle_failed"; showUsername: boolean }
  | { type: "revoke" }
  | { type: "revoke_failed" };

export function initialShareState(share: ShareDTO | null, showUsername: boolean): ShareState {
  return { status: share ? "ready" : "generating", share, showUsername: share?.showUsername ?? showUsername, copied: false, retryAfterSec: null, busy: false };
}

export function shareReducer(s: ShareState, a: ShareAction): ShareState {
  switch (a.type) {
    case "create":
      return { ...s, status: "generating", share: null, copied: false, retryAfterSec: null, busy: true };
    case "created":
      // The link exists; the image warms before `ready` (or 2 s pass).
      return { ...s, status: "generating", share: a.share, showUsername: a.share.showUsername, busy: false };
    case "image_ready":
      return s.status === "generating" && s.share ? { ...s, status: "ready" } : s;
    case "failed":
      return { ...s, status: "error", busy: false };
    case "rate_limited":
      return { ...s, status: "rate_limited", retryAfterSec: a.retryAfterSec, busy: false };
    case "copied":
      return s.status === "ready" ? { ...s, copied: true } : s;
    case "copy_reset":
      return { ...s, copied: false };
    case "toggle":
      return { ...s, showUsername: a.showUsername, busy: true };
    case "toggled":
      return { ...s, share: a.share, showUsername: a.share.showUsername, busy: false };
    case "toggle_failed":
      return { ...s, showUsername: a.showUsername, busy: false };
    case "revoke":
      return { ...s, status: "revoked", copied: false, busy: true };
    case "revoke_failed":
      return { ...s, status: s.share ? "ready" : "generating", busy: false };
  }
}

/** Which controls are live in each state (§4.3: Copy PGN works while generating; the link actions need the link). */
export function controlsFor(s: Pick<ShareState, "status" | "busy">): { link: boolean; pgn: boolean; toggle: boolean; stop: boolean } {
  const ready = s.status === "ready";
  return { link: ready, pgn: s.status !== "revoked", toggle: ready && !s.busy, stop: ready && !s.busy };
}

/** "Try again in 3 h." / "Try again in 12 min." / "Try again in 45 s." (the daily cap's long waits). */
export function waitLabel(sec: number): string {
  if (sec >= 3_600) return `${Math.ceil(sec / 3_600)} h`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} min`;
  return `${Math.max(1, Math.ceil(sec))} s`;
}

/** The X intent URL (`https://x.com/intent/post`). */
export function xIntentUrl(text: string, url: string): string {
  const q = new URLSearchParams({ text, url });
  return `https://x.com/intent/post?${q.toString()}`;
}

/** The image download URL: the share's image URL (it carries `?v=`) plus `download=1`. */
export function imageDownloadUrl(imageUrl: string): string {
  return `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}download=1`;
}

/** "playchess.tech/r/k7m2x9qa": the link without the scheme, as the input shows it. */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
