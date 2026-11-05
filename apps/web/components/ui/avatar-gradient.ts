// Pure helpers for <Avatar> (SPEC 6.2; 02 §4 `.avc`). No React, so node:test can load them.

/** The six `.avc` gradient pairs from the V4 boards, light end first. */
export const AVATAR_GRADIENTS = [
  ["#ddd6e2", "#82748f"],
  ["#d6dde2", "#6f8796"],
  ["#e6dcc2", "#a98a43"],
  ["#e4d3cf", "#a06f62"],
  ["#d8ddcf", "#7c8a6a"],
  ["#e2d6c6", "#a88c6d"],
] as const;

/** Classes for the gradient variant. Initials are decorative here: white reaches only 3.2–4.3:1 at the dark end. */
export const AVATAR_GRADIENT_CLASSES =
  "font-serif text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.18)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]";

/** FNV-1a, 32-bit. Stable across runs, platforms and server/client. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Index into AVATAR_GRADIENTS for a seed (user id, reference id or name). */
export function gradientIndex(seed: string): number {
  return hashSeed(seed) % AVATAR_GRADIENTS.length;
}

/** CSS `background-image` for a seed. */
export function gradientBackground(seed: string): string {
  const [from, to] = AVATAR_GRADIENTS[gradientIndex(seed)]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/**
 * Up to two uppercase initials: the first letter or digit of the first two words.
 * "Bobby Fischer" → "BF", "knightowl_88" → "K", "" → "?".
 */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "?";
}
