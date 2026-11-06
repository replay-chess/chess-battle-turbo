// Engine prefetch on bot intent (phase-02 plan 5.3.1, 5.4): when the "vs Computer" option gets hover or focus on
// /play (or any other bot entry point), the glue and the WASM are fetched into the HTTP cache with
// `<link rel="prefetch">`, so the game page usually starts with a cached engine. Once per page; skipped on
// Save-Data and 2G connections. Importing this module does not load the engine.

import { engineUrls } from "./manifest";

let done = false;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function slowOrSaving(): boolean {
  const c = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g");
}

function addLink(href: string, as: "fetch" | "script", crossOrigin: boolean): void {
  if (document.head.querySelector(`link[rel="prefetch"][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = as;
  link.href = href;
  if (crossOrigin) link.crossOrigin = "anonymous";
  link.dataset.rcEngine = "";
  document.head.appendChild(link);
}

/** Prefetches the engine files for this build (R2 when configured, else the hashed same-origin folder). */
export function prefetchEngine(): void {
  if (done || typeof document === "undefined") return;
  done = true;
  try {
    if (slowOrSaving()) return;
    const urls = engineUrls();
    const crossOrigin = urls.source === "r2";
    // The worker fetches the WASM with fetch() (CORS when cross-origin), the glue with importScripts().
    addLink(urls.wasm, "fetch", crossOrigin);
    addLink(urls.glue, "script", false);
  } catch {
    // Prefetch is a hint; never break the page.
  }
}

/** Spread on the bot entry ("vs Computer" card / button): `<button {...engineIntentProps()}>`. */
export function engineIntentProps(): { onPointerEnter: () => void; onFocus: () => void; onTouchStart: () => void } {
  return { onPointerEnter: prefetchEngine, onFocus: prefetchEngine, onTouchStart: prefetchEngine };
}

/** Test hook: lets a unit test run prefetchEngine() again. */
export function resetEnginePrefetchForTests(): void {
  done = false;
}
