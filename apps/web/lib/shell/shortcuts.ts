// The `?` list (V3Shortcuts): the static sections and the page sections registered at runtime. Separate from
// lib/shell/keys.ts (the key rules every page's listener needs), so only the shortcuts dialog and the pages that
// register a section load these tables; the dialog itself loads on first open (components/shell/AppShellView.tsx).

/** A flag a row or a section depends on (it shows only while the flag is on). */
export type ShortcutFlag = "review-v3" | "review-share";
/** Page scopes registered at runtime (`registerReviewShortcuts`) are `review:<area>`, e.g. `review:compare`. */
export type ShortcutScope = "global" | "board" | "review" | `review:${string}`;
/** "Mod" renders as ⌘ on Apple platforms and Ctrl elsewhere. `flag`: shown only while that flag is on. */
export type ShortcutRow = { id: string; label: string; keys: string[][]; flag?: ShortcutFlag };
export type ShortcutSection = { title: string; scope: ShortcutScope; rows: ShortcutRow[]; flag?: ShortcutFlag };
export type ShortcutFlags = { reviewV3?: boolean; reviewShare?: boolean };

/**
 * The shortcut registry. Section titles are Title Case; row labels are sentence
 * case (SPEC 3.11). Phase 1 registers Everywhere; Phase 2 adds In a Game (the
 * game page's keys, features/game/keys/useGameHotkeys.ts, P2 plan 4.6.1). Esc on
 * the game page (cancel a premove, then close the top layer) is the Everywhere
 * row. Later page keys register here and must pass findCollisions.
 */
export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "Everywhere",
    scope: "global",
    rows: [
      { id: "palette", label: "Command palette and search", keys: [["Mod", "K"], ["/"]] },
      { id: "help", label: "This list", keys: [["?"]] },
      { id: "go-play", label: "Go to Play", keys: [["G", "P"]] },
      { id: "go-legends", label: "Go to Legends", keys: [["G", "L"]] },
      { id: "go-review", label: "Go to Review", keys: [["G", "R"]], flag: "review-v3" },
      { id: "notifications", label: "Jump to notifications", keys: [["Alt", "T"]] },
      { id: "close", label: "Close a menu or sheet", keys: [["Esc"]] },
    ],
  },
  {
    title: "In a Game",
    scope: "board",
    rows: [
      { id: "game-step", label: "Previous or next move", keys: [["←"], ["→"]] },
      { id: "game-ends", label: "First or latest move", keys: [["↑"], ["↓"]] },
      { id: "game-flip", label: "Flip the board", keys: [["F"]] },
      { id: "game-sound", label: "Sound on or off", keys: [["M"]] },
      { id: "game-draw", label: "Offer a draw", keys: [["D"]] },
      { id: "game-hint", label: "Hint, again for the arrow", keys: [["H"]] },
      { id: "game-undo", label: "Undo (bot games)", keys: [["U"]] },
      { id: "game-promote", label: "Pick a promotion piece", keys: [["Q"], ["R"], ["B"], ["N"]] },
    ],
  },
  {
    // P3 (phase-03 plan §4.1; features/review/keys/useReviewHotkeys.ts). Esc (close the menu) is the Everywhere row.
    title: "In a Review",
    scope: "review",
    flag: "review-v3",
    rows: [
      { id: "review-step", label: "Previous or next move", keys: [["←"], ["→"]] },
      { id: "review-ends", label: "First or last move", keys: [["Home"], ["End"]] },
      { id: "review-narration", label: "Play or pause the coach", keys: [["Space"]] },
      { id: "review-primary", label: "Start, reveal, next moment or finish", keys: [["Enter"]] },
      { id: "review-flip", label: "Flip the board", keys: [["F"]] },
      { id: "review-tabs", label: "Moves or Coach tab", keys: [["M"], ["C"]] },
      { id: "review-moments", label: "Previous or next moment", keys: [["Shift", "←"], ["Shift", "→"]] },
      { id: "review-plan", label: "Pick a plan in a moment", keys: [["1"], ["2"], ["3"], ["4"], ["5"]] },
      { id: "review-line", label: "Show the best line", keys: [["L"]] },
      { id: "review-share", label: "Share the review", keys: [["S"]], flag: "review-share" },
      { id: "review-done", label: "Done (clean game)", keys: [["D"]] },
    ],
  },
];

// ── Page sections registered at runtime (registerReviewShortcuts) ───────────────────────────────────────────────

const registered = new Map<string, ShortcutSection>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

function flagOn(flag: ShortcutFlag | undefined, flags: ShortcutFlags): boolean {
  if (flag === undefined) return true;
  return flag === "review-v3" ? flags.reviewV3 === true : flags.reviewShare === true;
}

/**
 * Adds a page's shortcut section to the `?` list while the page is mounted (phase-03 plan §13.1: the review's
 * neighbours, e.g. Compare's tab keys, register through this helper). The section's scope must be its own
 * `review:<area>`, so its keys may reuse the review's (they never run on the same page); a collision inside the
 * section or with an Everywhere key throws, like the static registry's test. Returns the unregister function.
 */
export function registerReviewShortcuts(id: string, section: Omit<ShortcutSection, "scope"> & { scope: `review:${string}` }): () => void {
  const candidate: ShortcutSection = { ...section };
  const collisions = findCollisions([...SHORTCUT_SECTIONS.filter((s) => s.scope === "global"), candidate]);
  if (collisions.length) throw new Error(`registerReviewShortcuts(${id}): ${collisions.map((c) => `${c.binding} → ${c.ids.join(", ")}`).join("; ")}`);
  registered.set(id, candidate);
  registryVersion++;
  registryListeners.forEach((fn) => fn());
  return () => {
    if (registered.get(id) !== candidate) return;
    registered.delete(id);
    registryVersion++;
    registryListeners.forEach((fn) => fn());
  };
}

/** useSyncExternalStore pair for the dialog: re-render when a page registers or leaves. */
export function subscribeShortcutRegistry(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => registryListeners.delete(fn);
}
export function shortcutRegistryVersion(): number {
  return registryVersion;
}

/** The sections and rows for this viewer (flagged rows hide while their flag is off), then the registered pages'. */
export function shortcutSections(flags: ShortcutFlags = {}): ShortcutSection[] {
  const on = (flag: ShortcutFlag | undefined) => flagOn(flag, flags);
  return [...SHORTCUT_SECTIONS, ...registered.values()]
    .filter((s) => on(s.flag))
    .map((s) => ({ ...s, rows: s.rows.filter((r) => on(r.flag)) }));
}

export type Collision = { binding: string; ids: string[] };

/** Duplicate bindings within one scope, and global bindings reused by any scope. */
export function findCollisions(sections: ShortcutSection[]): Collision[] {
  const byScope = new Map<string, Map<string, string[]>>();
  for (const section of sections) {
    const scope = byScope.get(section.scope) ?? new Map<string, string[]>();
    byScope.set(section.scope, scope);
    for (const row of section.rows) {
      for (const seq of row.keys) {
        const binding = seq.map((k) => k.toLowerCase()).join(" ");
        scope.set(binding, [...(scope.get(binding) ?? []), row.id]);
      }
    }
  }
  const out: Collision[] = [];
  for (const scope of byScope.values()) {
    for (const [binding, ids] of scope) if (ids.length > 1) out.push({ binding, ids });
  }
  const global = byScope.get("global");
  if (global) {
    for (const [name, scope] of byScope) {
      if (name === "global") continue;
      for (const [binding, ids] of scope) {
        const g = global.get(binding);
        if (g) out.push({ binding, ids: [...g, ...ids] });
      }
    }
  }
  return out;
}
