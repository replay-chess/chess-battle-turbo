// The public share page's only script (phase-03 plan §4.4, §9.6 "a ≤ 6 kB stepper island"): Prev/Next, ←/→, Home/End
// and the move strip step through the frames the server replayed (share-view.ts), redrawing the board with the same
// `shareBoardSvg` the server used. It also sends `share_page_viewed` once (the referrer's bare host and whether a
// Clerk session cookie exists; never the URL, the path or the code) and `share_signup_clicked` from the trial button.
//
// No framework and no imports: html.ts inlines `(${shareIsland})(${shareBoardSvg}, cfg)` into the page, so the page
// loads no React, no Next runtime and no other script (FIX-2: the root layout's JS held the page at Lighthouse 83–86;
// G5 needs ≥ 95). The function must stay self-contained for that, like board-svg.ts.
import type { BoardFrame, shareBoardSvg } from "./board-svg";

/** One step of the island's data (`<script type="application/json" id="share-data">`). */
export interface IslandFrame extends BoardFrame {
  /** "19." / "19…" + SAN, null for the start. */
  t: string | null;
}

export interface IslandData {
  frames: IslandFrame[];
  start: number;
  orientation: "w" | "b";
  moment: { index: number; arrow: [string, string] } | null;
  /** Grade key → its name ("blunder" → "Blunder"). */
  names: Record<string, string>;
}

export interface IslandConfig {
  /** The e2e telemetry sink (NEXT_PUBLIC_TELEMETRY_SINK=1 on a test build): events go to window.__rcTelemetry. */
  sink: boolean;
  /** NEXT_PUBLIC_POSTHOG_KEY (public by design), or null: no PostHog request at all. */
  posthogKey: string | null;
  appEnv: string;
}

export function shareIsland(board: typeof shareBoardSvg, cfg: IslandConfig): void {
  const doc = document;
  const dataEl = doc.getElementById("share-data");
  const root = doc.querySelector<HTMLElement>("[data-testid='share-stepper']");
  if (!dataEl || !root) return;
  const data = JSON.parse(dataEl.textContent || "{}") as IslandData;
  const frames = data.frames;
  const last = frames.length - 1;
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const boardBox = q("[data-board]");
  const pos = q("[data-testid='share-position']");
  const prev = q("[data-testid='share-prev']") as HTMLButtonElement | null;
  const next = q("[data-testid='share-next']") as HTMLButtonElement | null;
  const strip = q("[data-testid='share-strip']");
  const id = "anon-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const track = (event: string, props: Record<string, unknown>) => {
    try {
      if (cfg.sink) {
        const w = window as unknown as { __rcTelemetry?: unknown[] };
        (w.__rcTelemetry = w.__rcTelemetry || []).push({ event, props, ts: Date.now() });
      }
      if (cfg.posthogKey) {
        const body = JSON.stringify({
          api_key: cfg.posthogKey,
          event,
          distinct_id: id,
          properties: Object.assign({}, props, { app_env: cfg.appEnv, $process_person_profile: false, $lib: "replay-share" }),
        });
        void fetch("/ingest/i/v0/e/", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(
          () => undefined,
        );
      }
    } catch {
      // Telemetry never breaks the page.
    }
  };

  const nameOf = (k: string | null) => (k ? data.names[k] || k : "");
  let index = Math.min(Math.max(data.start, 0), last);
  const show = (i: number) => {
    index = Math.min(Math.max(i, 0), last);
    const f = frames[index];
    if (!f) return;
    const graded = f.q ? ", marked " + nameOf(f.q) : "";
    const position = f.t ? "Position after " + f.t + graded + "." : "Starting position.";
    const atMoment = !!data.moment && data.moment.index === index;
    if (boardBox) boardBox.innerHTML = board(f, data.orientation, atMoment && data.moment ? data.moment.arrow : null, atMoment ? position + " Arrow shows the engine’s move." : position);
    if (pos) {
      pos.textContent = f.t ? f.t + (f.q ? " · " + nameOf(f.q) : "") : "Start";
      const count = doc.createElement("span");
      count.className = "soft";
      count.textContent = " · " + index + " of " + last;
      pos.appendChild(count);
    }
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= last;
    root.setAttribute("data-index", String(index));
    if (strip) {
      strip.querySelectorAll<HTMLElement>("[data-i]").forEach((b) => {
        if (Number(b.getAttribute("data-i")) === index) {
          b.setAttribute("aria-current", "true");
          b.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else b.removeAttribute("aria-current");
      });
    }
  };

  prev?.addEventListener("click", () => show(index - 1));
  next?.addEventListener("click", () => show(index + 1));
  strip?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-i]");
    if (b) show(Number(b.getAttribute("data-i")));
  });
  root.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (to === null) return;
    e.preventDefault();
    show(to);
  });
  doc.querySelectorAll("[data-testid='share-signup']").forEach((a) => a.addEventListener("click", () => track("share_signup_clicked", {})));

  // share_page_viewed: the referrer's bare host (no port, no IP with a port, "none" otherwise) and whether Clerk's
  // `__client_uat` cookie says a session exists (beacon.ts holds the same rules, unit-tested).
  let referrer = "none";
  try {
    if (doc.referrer) {
      const u = new URL(doc.referrer);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const ok = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
      if (!u.port && host.length <= 80 && ok) referrer = host;
    }
  } catch {
    referrer = "none";
  }
  const signedIn = doc.cookie.split(";").some((part) => {
    const kv = part.trim().split("=");
    const name = kv[0] || "";
    const value = kv.slice(1).join("=").trim();
    return (name === "__client_uat" || name.indexOf("__client_uat_") === 0) && value !== "" && value !== "0";
  });
  track("share_page_viewed", { referrer_domain: referrer, signed_in: signedIn });
  root.setAttribute("data-ready", "");
}
