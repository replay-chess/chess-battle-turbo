// Copy rules for the shell (SPEC 3.11). Data modules are imported (they pull in
// no Clerk or Prisma code); component labels are read from the source as text.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DESTINATIONS, backFor, enabledDestinations } from "../nav/destinations";
import { SHORTCUT_SECTIONS } from "./shortcuts";
import { PALETTE_GROUPS, buildPaletteRows } from "./palette";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MINOR = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at"]);

/** Title Case; minor words may stay lower case after the first word; "(press /)" hints are ignored. */
function isTitleCase(text: string): boolean {
  const words = text
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (!words.length) return false;
  return words.every((word, i) =>
    word.split("-").every((part, j) => {
      const letters = part.replace(/^[^\p{L}]+/u, "");
      if (!letters) return true;
      if (i > 0 && j === 0 && MINOR.has(letters.toLowerCase()) && letters === letters.toLowerCase()) return true;
      return /^\p{Lu}/u.test(letters);
    }),
  );
}

/** First letter capital and not all caps. */
function isSentenceCase(text: string): boolean {
  return /^\p{Lu}/u.test(text) && text !== text.toUpperCase();
}

function filesUnder(rel: string): string[] {
  const dir = path.join(WEB, rel);
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => path.join(dir, f));
}

/** Literal labels in shell components: label/aria-label/title attributes, `label:` fields and Button text. */
function componentLabels(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const file of filesUnder("components/shell")) {
    const src = readFileSync(file, "utf8");
    const add = (text: string) => out.push({ file: path.relative(WEB, file), text });
    for (const m of src.matchAll(/\b(?:aria-label|label|title)="([^"]+)"/g)) add(m[1]!);
    for (const m of src.matchAll(/\blabel: ([^,\n]+)/g)) for (const s of m[1]!.matchAll(/"([^"]+)"/g)) add(s[1]!);
    for (const m of src.matchAll(/<Button\b[\s\S]*?>\s*([^<{}>]+?)\s*<\/Button>/g)) add(m[1]!);
  }
  return out;
}

test("the checkers themselves", () => {
  assert.equal(isTitleCase("Find an Opponent · 5+3"), true);
  assert.equal(isTitleCase("Single-Key Shortcuts"), true);
  assert.equal(isTitleCase("Search (press /)"), true);
  assert.equal(isTitleCase("Switch to dark theme"), false);
  assert.equal(isTitleCase("the Start"), false);
  assert.equal(isSentenceCase("Go to Play"), true);
  assert.equal(isSentenceCase("GO TO PLAY"), false);
  assert.equal(isSentenceCase("this list"), false);
});

test("destination, SubNav and Back labels are Title Case", () => {
  for (const d of DESTINATIONS) assert.ok(isTitleCase(d.label), d.label);
  for (const d of enabledDestinations()) assert.ok(isTitleCase(backFor(d.key, { referenceId: "x" }).label), d.key);
});

test("palette row titles and group headings are Title Case", () => {
  const me = { referenceId: "x" };
  const rows = [
    ...buildPaletteRows({ me, isAdmin: true, theme: "light" }),
    ...buildPaletteRows({ me, isAdmin: true, theme: "dark" }),
  ];
  for (const r of rows) assert.ok(isTitleCase(r.title), r.title);
  for (const g of PALETTE_GROUPS) assert.ok(isTitleCase(g.heading), g.heading);
});

test("shortcut section titles are Title Case and row labels sentence case", () => {
  for (const s of SHORTCUT_SECTIONS) {
    assert.ok(isTitleCase(s.title), s.title);
    for (const r of s.rows) assert.ok(isSentenceCase(r.label), r.label);
  }
});

test("account items, buttons, switches and dialog titles in components/shell are Title Case", () => {
  const labels = componentLabels();
  const texts = labels.map((l) => l.text);
  for (const expected of [
    "Membership",
    "Manage Billing",
    "Sign Out",
    "Keyboard Shortcuts",
    "Command Palette",
    "Single-Key Shortcuts",
    "Update Payment",
    "Account Menu",
  ]) {
    assert.ok(texts.includes(expected), `expected to find the label "${expected}"`);
  }
  for (const { file, text } of labels) assert.ok(isTitleCase(text), `${file}: "${text}"`);
});

test("no pictographs in components/shell, lib/nav or lib/shell", () => {
  const allowed = /[⌘↑↓↵·…⋯→✓★⏎]/gu;
  for (const file of [...filesUnder("components/shell"), ...filesUnder("lib/nav"), ...filesUnder("lib/shell")]) {
    const src = readFileSync(file, "utf8").replace(allowed, "");
    const hit = src.match(/\p{Extended_Pictographic}/u);
    assert.equal(hit, null, `${path.relative(WEB, file)} contains ${hit?.[0]}`);
  }
});
