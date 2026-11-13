// One-viewport assertions (SPEC 10.6, 04 §8.5). Tap targets reuse
// expectTapTargets from ../helpers.
import type { Page } from "@playwright/test";
import { expect } from "../helpers";

export type Box = { x: number; y: number; width: number; height: number };

export type LayoutSnapshot = {
  vw: number;
  vh: number;
  scrollW: number;
  scrollH: number;
  scrollTop: number;
  main: { sh: number; ch: number; sw: number; cw: number } | null;
  board: Box | null;
  bars: Box[];
  /** Visible [data-rc-nav] / [data-rc-tabbar] boxes. */
  nav: Box[];
  escaped: string[];
};

/**
 * Measures the page: document scroll, main's safety scroll, the board, bars and
 * nav, and every element inside the root that escapes the viewport after the
 * intentional clips inside the root (scroll regions, truncation).
 * Ignored: [inert], [data-rc-allow-overflow], [data-nextjs-toast], and the skip
 * link while it is parked off-screen (it slides in on focus).
 */
export async function snapshotLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const vh = de.clientHeight; // excludes scrollbars
    const se = document.scrollingElement!;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const name = (el: Element) =>
      el.tagName.toLowerCase() +
      (el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : "") +
      [...el.attributes]
        .filter((a) => a.name.startsWith("data-rc-"))
        .map((a) => `[${a.name}]`)
        .join("") +
      (typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "");

    const root = document.querySelector("[data-rc-viewport]");
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      let { left, top, right, bottom } = r;
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          const c = a.getBoundingClientRect();
          left = Math.max(left, c.left);
          top = Math.max(top, c.top);
          right = Math.min(right, c.right);
          bottom = Math.min(bottom, c.bottom);
        }
      }
      return { left, top, right, bottom, empty: right <= left || bottom <= top };
    };
    const escaped: string[] = [];
    if (root) {
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("[inert], [data-rc-allow-overflow], [data-nextjs-toast]")) continue;
        if (el.closest('[data-testid="skip-link"]') && !el.closest(":focus")) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const v = visible(el);
        if (v.empty) continue;
        if (v.left < -1 || v.top < -1 || v.right > vw + 1 || v.bottom > vh + 1) escaped.push(name(el));
      }
    }
    const main = document.querySelector("[data-rc-main]");
    return {
      vw,
      vh,
      scrollW: se.scrollWidth,
      scrollH: se.scrollHeight,
      scrollTop: se.scrollTop,
      main: main && { sh: main.scrollHeight, ch: main.clientHeight, sw: main.scrollWidth, cw: main.clientWidth },
      board: box(document.querySelector('[data-testid="chess-board"]')),
      bars: [...document.querySelectorAll("[data-rc-bar], [data-rc-controls]")].map((b) => box(b)!),
      nav: [...document.querySelectorAll("[data-rc-nav], [data-rc-tabbar]")]
        .filter((n) => getComputedStyle(n).display !== "none")
        .map((n) => box(n)!),
      escaped: [...new Set(escaped)].slice(0, 20),
    };
  });
}

export const inside = (b: Box | null | undefined, vw: number, vh: number) =>
  !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vw + 0.5 && b.y + b.height <= vh + 0.5;

/**
 * Corners and centre of the board hit the board itself: no toast, sheet, tab
 * bar or overlay covers it. Layers inside [data-nextjs-toast] or
 * [data-rc-allow-overflow] are looked through.
 */
export async function boardHits(page: Page, b: Box): Promise<boolean[]> {
  return page.evaluate(({ x, y, width, height }) => {
    const board = document.querySelector('[data-testid="chess-board"]')!;
    const points = [
      [x + 2, y + 2],
      [x + width - 2, y + 2],
      [x + 2, y + height - 2],
      [x + width - 2, y + height - 2],
      [x + width / 2, y + height / 2],
    ] as const;
    return points.map(([px, py]) => {
      const top = document
        .elementsFromPoint(px, py)
        .find((el) => !el.closest("[data-nextjs-toast], [data-rc-allow-overflow], nextjs-portal"));
      return !!top && board.contains(top);
    });
  }, b);
}

/**
 * The page fits one viewport: no document scroll, no main safety scroll, nothing
 * clipped by the viewport, the page is in lock mode, and (opts.board) the board
 * is square, at least 220px, unoccluded and inside with its bars and controls.
 * opts.nav: true expects exactly one visible nav; false expects none.
 */
export async function expectOneViewport(page: Page, opts: { board?: boolean; nav?: boolean } = {}) {
  const lock = await page.evaluate(() => document.documentElement.matches(":has(.rc-vs [data-rc-lock])"));
  expect(lock, "page must contain .rc-vs [data-rc-lock] (lock mode)").toBe(true);

  const s = await snapshotLayout(page);
  expect(s.scrollH, "document must not scroll vertically").toBeLessThanOrEqual(s.vh + 1);
  expect(s.scrollW, "no horizontal overflow").toBeLessThanOrEqual(s.vw + 1);
  expect(s.main, "[data-rc-main] present").not.toBeNull();
  expect(s.main!.sh, "main must not need its safety scroll inside the matrix").toBeLessThanOrEqual(s.main!.ch + 1);
  expect(s.main!.sw, "main has no horizontal overflow").toBeLessThanOrEqual(s.main!.cw + 1);
  expect(s.escaped, "elements clipped by the viewport").toEqual([]);
  if (opts.nav === true) {
    expect(s.nav.length, "exactly one nav visible").toBe(1);
    expect(inside(s.nav[0], s.vw, s.vh), "nav inside the viewport").toBe(true);
  } else if (opts.nav === false) {
    expect(s.nav.length, "no nav visible").toBe(0);
  }
  if (opts.board) {
    expect(s.board, "board present").not.toBeNull();
    const b = s.board!;
    expect(inside(b, s.vw, s.vh), "board fully inside the viewport").toBe(true);
    expect(Math.abs(b.width - b.height), "board is square").toBeLessThan(1);
    expect(b.width, "README floor: board >= 220px").toBeGreaterThanOrEqual(220 - 0.5);
    for (const bar of s.bars) expect(inside(bar, s.vw, s.vh), "player bars and controls on screen").toBe(true);
    expect(await boardHits(page, b), "board corners and centre not occluded").toEqual([true, true, true, true, true]);
  }
  return s;
}

/** Geometry of the BoardStage regions on the page. */
export async function stageGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const inner = document.querySelector(".rc-stage__in");
    return {
      mode: inner ? getComputedStyle(inner).getPropertyValue("--rc-mode").trim() : null,
      stage: box("[data-rc-stage]"),
      col: box("[data-rc-stage] section"),
      board: box('[data-testid="chess-board"]'),
      aside: box("[data-rc-aside]"),
      bottomBar: box('[data-rc-bar="bottom"]'),
      controls: box("[data-rc-controls]"),
    };
  });
}

/**
 * Labels that must be read whole (button text, the review's accuracy line): every visible match keeps its text inside
 * its own box (scrollWidth ≤ clientWidth, unless it ellipsizes on purpose) and inside the nearest ancestor that clips.
 * Returns nothing; fails with the cut labels. regression: dev pass D8 ("Rematch · as Bla" at 1200 px) and D9 (the
 * review's bottom bar at 125 %: "Accuracy 78 · o").
 */
export async function expectNoClippedText(page: Page, selector: string): Promise<void> {
  const cut = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => el.getClientRects().length > 0)
      .flatMap((el) => {
        const label = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || el.getAttribute("aria-label") || el.tagName;
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") return [`${label}: text ${el.scrollWidth} px in ${el.clientWidth} px`];
        const r = el.getBoundingClientRect();
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX === "visible" && s.overflowY === "visible") continue;
          const p = a.getBoundingClientRect();
          if (r.right > p.right + 1 || r.left < p.left - 1) return [`${label}: clipped by ${a.className || a.tagName}`];
          break;
        }
        return [];
      }),
  );
  expect(cut, `labels cut (${selector})`).toEqual([]);
}
