// The public share page as one HTML document (phase-03 plan §4.4, §5.5, §11.3; G5). route.ts serves it. Built as a
// string with every value escaped: names, titles and summaries come from the frozen snapshot, which a member wrote.
//
// Layout, testids and copy are the former React page's (V3RvShare's preview card, larger): the marketing top nav
// (logo, Pricing, Start Free Trial), the board with the players and the stepper, the review panel (title, meta,
// accuracy, the key moment, the summary, the trial CTA) and P11's compact footer. The `gone` and `not_found` answers
// are the same chrome around one notice. The only script is the stepper island (island.ts, ≤ 6 kB gzipped).
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "@repo/contracts/http/share";
import { QUALITY_LABEL } from "@/features/review/quality-labels";
import { shareBoardSvg, type BoardFrame } from "./board-svg";
import { GONE_BODY, GONE_TITLE, NOT_FOUND_BODY, NOT_FOUND_TITLE } from "./copy";
import { gradeIcon } from "./grades";
import { shareIsland, type IslandConfig, type IslandData, type IslandFrame } from "./island";
import { SHARE_CSS } from "./share-css";
import { accuracyLine, shareMetaText, type ShareFrame, type ShareView } from "./share-view";

/** HTML text and attribute escaping. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** JSON inside a <script> element: nothing can close the element or start a comment. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const FOOT = [
  { href: "/how-we-grade", label: "How We Grade" },
  { href: "/about", label: "About" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

const CHEVRON = (d: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL of the share image (ok pages only). */
  image: string | null;
}

function head(meta: PageMeta): string {
  const t = esc(meta.title);
  const d = esc(meta.description);
  const og = meta.image
    ? [
        `<meta property="og:title" content="${t}">`,
        `<meta property="og:description" content="${d}">`,
        `<meta property="og:site_name" content="ReplayChess">`,
        `<meta property="og:type" content="article">`,
        `<meta property="og:image" content="${esc(meta.image)}">`,
        `<meta property="og:image:width" content="${SHARE_IMAGE_WIDTH}">`,
        `<meta property="og:image:height" content="${SHARE_IMAGE_HEIGHT}">`,
        `<meta property="og:image:alt" content="${t}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${t}">`,
        `<meta name="twitter:description" content="${d}">`,
        `<meta name="twitter:image" content="${esc(meta.image)}">`,
      ].join("")
    : "";
  return [
    `<head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta name="robots" content="noindex, nofollow">`,
    `<meta name="referrer" content="no-referrer">`,
    `<meta name="theme-color" content="#FAF9F6" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">`,
    `<link rel="icon" href="/favicon.ico" sizes="any">`,
    og,
    `<style>${SHARE_CSS}</style></head>`,
  ].join("");
}

function chrome(state: "ok" | "gone" | "not_found", main: string): string {
  return [
    `<div class="page" data-testid="share-page" data-state="${state}">`,
    `<header class="nav" data-testid="share-nav">`,
    `<a href="/" class="brand" data-testid="shell-brand"><img src="/chess-logo-72.png" alt="ReplayChess home" width="36" height="36"><span aria-hidden="true" class="wordmark">ReplayChess</span></a>`,
    `<nav aria-label="Main" style="display:flex"><a href="/pricing" class="navlink lbl" data-testid="share-nav-pricing">Pricing</a></nav>`,
    `<a href="/pricing" class="btn" data-testid="share-nav-trial">Start Free Trial</a>`,
    `</header>`,
    `<main id="main">${main}</main>`,
    `<footer class="foot"><span>© Replay Chess</span>${FOOT.map((l) => `<a href="${l.href}">${esc(l.label)}</a>`).join("")}</footer>`,
    `</div>`,
  ].join("");
}

/** The `gone` and `not_found` answers: a centred message and one way on. */
export function noticePage(state: "gone" | "not_found"): string {
  const [title, body, testId] = state === "gone" ? [GONE_TITLE, GONE_BODY, "share-gone"] : [NOT_FOUND_TITLE, NOT_FOUND_BODY, "share-not-found"];
  const main = [
    `<div class="notice" data-testid="${testId}"><div>`,
    `<span class="lbl">Shared review</span>`,
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(body)}</p>`,
    `<a href="/" class="btn" data-testid="share-see-how">See How Replay Chess Works</a>`,
    `</div></div>`,
  ].join("");
  const metaTitle = state === "gone" ? "Review link expired" : "Review link not found";
  return document(head({ title: metaTitle, description: title, image: null }), chrome(state, main), null);
}

function playerLine(view: ShareView, side: "w" | "b"): string {
  const p = view.players[side];
  return [
    `<span class="player"><span class="name">${esc(p.name)}</span>`,
    p.rating !== null ? `<span class="sub">${p.rating}</span>` : "",
    `<span class="sub">${side === "w" ? "White" : "Black"}</span></span>`,
  ].join("");
}

function badge(q: string): string {
  const icon = gradeIcon(q as keyof typeof QUALITY_LABEL);
  return icon ? `<img src="${icon}" alt="" width="16" height="16">` : `<span aria-hidden="true" class="glyph" data-q="${esc(q)}">!?</span>`;
}

const boardFrame = (f: ShareFrame): BoardFrame => ({ p: f.placement, l: f.last, q: f.q, c: f.check });

function boardLabel(view: ShareView, i: number): string {
  const f = view.frames[i]!;
  const graded = f.q ? `, marked ${QUALITY_LABEL[f.q]}` : "";
  const position = f.label ? `Position after ${f.label}${graded}.` : "Starting position.";
  return view.moment && view.moment.index === i ? `${position} Arrow shows the engine’s move.` : position;
}

function stepper(view: ShareView): string {
  const last = view.frames.length - 1;
  const i = Math.min(Math.max(view.startIndex, 0), Math.max(last, 0));
  const f = view.frames[i];
  if (!f) return "";
  const atMoment = view.moment !== null && view.moment.index === i;
  const svg = shareBoardSvg(boardFrame(f), view.orientation, atMoment ? view.moment!.arrow : null, boardLabel(view, i));
  const position = f.label ? `${esc(f.label)}${f.q ? ` · ${esc(QUALITY_LABEL[f.q])}` : ""}` : "Start";
  const strip = view.frames
    .slice(1)
    .map((s, k) => {
      const n = k + 1;
      const aria = `${s.label ?? ""}${s.q ? `, ${QUALITY_LABEL[s.q]}` : ""}`;
      return `<li><button type="button" data-i="${n}"${n === i ? ` aria-current="true"` : ""} aria-label="${esc(aria)}"${s.q ? ` data-q="${esc(s.q)}"` : ""}>${esc(s.label ?? "")}${s.q ? badge(s.q) : ""}</button></li>`;
    })
    .join("");
  return [
    `<div class="stepper" data-testid="share-stepper" data-index="${i}">`,
    `<div class="boardbox" data-board="">${svg}</div>`,
    `<div class="controls">`,
    `<button type="button" class="step" aria-label="Previous move" data-testid="share-prev"${i <= 0 ? " disabled" : ""}>${CHEVRON("M15 6l-6 6 6 6")}</button>`,
    `<p class="position" aria-live="polite" data-testid="share-position">${position}<span class="soft"> · ${i} of ${last}</span></p>`,
    `<button type="button" class="step" aria-label="Next move" data-testid="share-next"${i >= last ? " disabled" : ""}>${CHEVRON("m9 6 6 6-6 6")}</button>`,
    `</div>`,
    `<ol class="strip" aria-label="Graded moves" data-testid="share-strip">${strip}</ol>`,
    `</div>`,
  ].join("");
}

/** The island's data: short keys, positions as FEN placements, no chess code needed. */
export function islandData(view: ShareView): IslandData {
  const frames: IslandFrame[] = view.frames.map((f) => ({ ...boardFrame(f), t: f.label }));
  return {
    frames,
    start: view.startIndex,
    orientation: view.orientation,
    moment: view.moment ? { index: view.moment.index, arrow: view.moment.arrow } : null,
    names: { ...QUALITY_LABEL },
  };
}

/** `(${shareIsland})(${shareBoardSvg}, cfg)`: the page's one script. */
export function islandScript(cfg: IslandConfig): string {
  return `(${shareIsland.toString()})(${shareBoardSvg.toString()},${scriptJson(cfg)});`;
}

/** The ok page. */
export function sharePage(view: ShareView, opts: { image: string; island: IslandConfig }): string {
  const acc = accuracyLine(view.accuracy);
  const top = view.orientation === "w" ? "b" : "w";
  const { title, description } = shareMetaText(view);
  const facts = [
    `<section aria-label="Review" tabindex="0" class="facts" data-testid="share-facts">`,
    `<span class="lbl">Game review</span>`,
    `<h1 data-testid="share-title">${esc(view.title)}</h1>`,
    `<p class="meta">${esc(view.meta)}${view.meta ? " · " : ""}<time datetime="${esc(view.playedOn)}">${esc(view.playedOn)}</time></p>`,
    view.accuracy.you !== null
      ? `<div class="acc" data-testid="share-accuracy"><span class="num"><span class="big">${view.accuracy.you}</span><span class="lbl">Accuracy</span></span>${
          acc ? `<span class="sr-only">${esc(acc)}</span>` : ""
        }${view.accuracy.opp !== null ? `<span class="opp" aria-hidden="true">Opponent ${view.accuracy.opp}</span>` : ""}</div>`
      : "",
    view.moment ? `<p class="moment" data-testid="share-moment">${esc(view.moment.caption)}</p>` : "",
    view.summary.length ? `<div class="summary" data-testid="share-summary">${view.summary.map((s) => `<p>${esc(s)}</p>`).join("")}</div>` : "",
    `<div class="cta" data-testid="share-cta"><p>Get your own games reviewed, move by move.</p>`,
    `<a href="/pricing" class="btn" data-testid="share-signup">Start 7-Day Free Trial</a></div>`,
    `</section>`,
  ].join("");
  const body = [
    `<div class="body" data-testid="share-body">`,
    `<section aria-label="The game" class="game">`,
    `<div class="players" data-testid="share-top-player">${playerLine(view, top)}</div>`,
    stepper(view),
    `<div class="players bottom-player" data-testid="share-bottom-player">${playerLine(view, view.orientation)}</div>`,
    `</section>`,
    facts,
    `</div>`,
  ].join("");
  return document(
    head({ title, description, image: opts.image }),
    chrome("ok", body),
    `<script type="application/json" id="share-data">${scriptJson(islandData(view))}</script><script>${islandScript(opts.island)}</script>`,
  );
}

function document(headHtml: string, bodyHtml: string, scripts: string | null): string {
  return `<!doctype html><html lang="en">${headHtml}<body>${bodyHtml}${scripts ?? ""}</body></html>`;
}
