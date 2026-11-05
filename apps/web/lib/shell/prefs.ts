import { useSyncExternalStore } from "react";

// "Single-Key Shortcuts" preference (SPEC 8.2 ShortcutsDialog). Stored as "0"/"1"
// in localStorage, default on. Phase 9 moves the switch to Settings › Board.

export const SINGLE_KEY_STORAGE_KEY = "rc-single-key-shortcuts";

/** Default on: only "0" turns single keys off. */
export function parseSingleKeyPref(value: string | null): boolean {
  return value !== "0";
}

const listeners = new Set<() => void>();
/** Used only when storage is blocked. */
let memoryValue: boolean | null = null;

function read(): boolean {
  try {
    return parseSingleKeyPref(window.localStorage.getItem(SINGLE_KEY_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function setSingleKeyEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SINGLE_KEY_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage can be blocked (private mode); the switch then lasts for this page only.
    memoryValue = enabled;
  }
  for (const listener of listeners) listener();
}

function snapshot(): boolean {
  return memoryValue ?? read();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SINGLE_KEY_STORAGE_KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Server snapshot true (on). */
export function useSingleKeyShortcuts(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/** Non-hook read for event handlers. */
export function singleKeyEnabledNow(): boolean {
  if (typeof window === "undefined") return true;
  return snapshot();
}
