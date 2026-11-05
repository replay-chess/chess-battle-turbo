// Keyboard rules for the shell (SPEC 8.2 "Keys", D20). Pure: no DOM globals,
// so every rule is unit-tested. useShellKeys wires them to one window listener.

/** Anything that looks like an Element for the editable check. */
type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** input, textarea, select, contenteditable, or inside [role=combobox]. */
export function isEditableTarget(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const node = el as ElementLike;
  if (node.tagName && EDITABLE_TAGS.has(node.tagName.toUpperCase())) return true;
  if (node.isContentEditable) return true;
  if (typeof node.closest === "function") {
    return Boolean(node.closest('[contenteditable=""], [contenteditable="true"], [role="combobox"]'));
  }
  return false;
}

export type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
};

export function isApplePlatform(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A modal of any kind is open: Radix dialogs, legacy modals, Clerk, the iOS install modal. */
export const MODAL_OPEN_SELECTOR =
  '[aria-modal="true"], [role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), .cl-modalBackdrop, [data-rc-modal]';

/** Marks the shell's own palette and shortcuts dialogs, so they don't count as "a modal is open". */
export const SHELL_DIALOG_ATTR = "data-rc-shell-dialog";

export type KeyLike = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  getModifierState?: (key: string) => boolean;
};

export type KeyContext = {
  /** (hover: none) and (pointer: coarse) */
  coarse: boolean;
  singleKeyEnabled: boolean;
  /** A modal that is not one of the shell's own dialogs is open. */
  modalOpen: boolean;
  /** The palette or the shortcuts dialog is open. */
  shellDialogOpen: boolean;
  editable: boolean;
};

export type KeyAction = "palette" | "slash" | "help" | "chord-key" | "ignore";

export function classifyKeydown(e: KeyLike, ctx: KeyContext): KeyAction {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.key === "Process") return "ignore";
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  const ctrl = e.ctrlKey && !altGraph;
  const alt = e.altKey && !altGraph;

  const isK = e.code === "KeyK" || e.key === "k" || e.key === "K";
  if (isK && (e.metaKey || ctrl)) {
    // ⌘K works everywhere: in fields, on touch, over the shell's own dialogs.
    if (ctx.modalOpen && !ctx.shellDialogOpen) return "ignore";
    return "palette";
  }

  // Single keys: fine pointers, switch on, outside fields, no modal (WCAG 2.1.4).
  if (ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen || ctx.shellDialogOpen) return "ignore";
  if (e.metaKey || ctrl || alt) return "ignore";
  if (e.key === "/") return "slash";
  if (e.key === "?") return "help";
  return "chord-key";
}

export type ChordMachine = {
  press: (code: string, key: string, now: number) => { navigate?: string; armed?: boolean };
};

/** "п" on a Russian layout still has code KeyP; letters without a code fall back to the key. */
function codeFor(code: string, key: string): string {
  if (code) return code;
  return /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "";
}

export function createChordMachine({
  timeoutMs,
  chords,
}: {
  timeoutMs: number;
  chords: Record<string, string>;
}): ChordMachine {
  let armedAt: number | null = null;
  return {
    press(code, key, now) {
      const wasArmed = armedAt !== null && now - armedAt <= timeoutMs;
      armedAt = null;
      if (wasArmed) {
        const target =
          chords[codeFor(code, key)] ?? (/^[a-z]$/i.test(key) ? chords[`Key${key.toUpperCase()}`] : undefined);
        return target ? { navigate: target } : {};
      }
      if (code === "KeyG" || key === "g") {
        armedAt = now;
        return { armed: true };
      }
      return {};
    },
  };
}

/** The Phase 1 chords: G then P, G then L. */
export const SHELL_CHORDS: Record<string, string> = { KeyP: "/play", KeyL: "/legends" };
export const CHORD_TIMEOUT_MS = 1000;

/** "Mod" renders as ⌘ on Apple platforms and Ctrl elsewhere. */
export type ShortcutRow = { id: string; label: string; keys: string[][] };
export type ShortcutSection = { title: string; scope: "global" | "board" | "review"; rows: ShortcutRow[] };

/**
 * The shortcut registry. Phase 1 registers only Everywhere. Section titles are
 * Title Case; row labels are sentence case (SPEC 3.11). Phase 2's page keys
 * (F, D, M, N, B, A, E, H, R, S, V) register here and must pass findCollisions.
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
      { id: "notifications", label: "Jump to notifications", keys: [["Alt", "T"]] },
      { id: "close", label: "Close a menu or sheet", keys: [["Esc"]] },
    ],
  },
];

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
