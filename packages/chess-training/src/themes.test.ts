// themes.ts: every key has labels and a group, picker order, primary-theme priority, the shard bitmask round trip,
// `rc:*` never in shard bits, and the committed manifest's bit table equal to this one (phase-05 plan §8.11, §12.1).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isKnownTheme,
  isThemeKey,
  maskHas,
  PICKER_MAIN_COUNT,
  PICKER_THEMES,
  primaryTheme,
  SHARD_THEME_BITS,
  shardBitsTable,
  THEME_GROUP_KEYS,
  themeBit,
  themeGroup,
  themeLabel,
  themeMask,
  themeNoun,
  themePluralLabel,
  THEMES,
  themesOfMask,
} from "./themes";
import { mulberry32 } from "./session";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("taxonomy", () => {
  it("gives every key a label, a plural, a group and a wire-valid key", () => {
    for (const [key, info] of Object.entries(THEMES)) {
      assert.ok(isThemeKey(key), key);
      assert.ok(info.label.length > 0 && info.label.length <= 40, key);
      assert.ok(info.plural.length > 0 && info.plural.length <= 40, key);
      assert.ok((THEME_GROUP_KEYS as readonly string[]).includes(info.group) && (info.group as string) !== "recommended", key);
      assert.equal(info.bit, themeBit(key), key);
    }
    assert.ok(SHARD_THEME_BITS.every((k) => THEMES[k]?.bit === themeBit(k)), "every shard key is in the table");
  });

  it("matches the contract fixtures' labels (singular on rows, plural in the picker)", () => {
    assert.equal(themeLabel("fork"), "Fork");
    assert.equal(themePluralLabel("fork"), "Forks");
    assert.equal(themeLabel("hangingPiece"), "Loose piece");
    assert.equal(themePluralLabel("hangingPiece"), "Loose pieces");
    assert.equal(themeLabel("rc:recapture"), "Recapture first");
    assert.equal(themeLabel("backRankMate"), "Back rank");
    assert.equal(themeLabel("rc:pawnStructure"), "Pawn structure");
    assert.equal(themeLabel("rc:defendedTarget"), "Defended pawn");
    assert.equal(themePluralLabel("capturingDefender"), "Remove the defender");
    assert.equal(themePluralLabel("defensiveMove"), "Defend the threat");
    assert.equal(themeNoun("fork"), "fork");
    assert.equal(themeNoun("discoveredAttack"), "discovered attack");
  });

  it("gives an unlisted Lichess key a readable label", () => {
    assert.equal(themeLabel("bodenMate"), "Boden mate");
    assert.equal(isKnownTheme("bodenMate"), false);
    assert.equal(isKnownTheme("mix"), true);
    assert.equal(themeLabel("mix"), "Mixed");
  });

  it("lists the picker in the plan's order, six shown first, every one a shard theme", () => {
    assert.deepEqual(PICKER_THEMES.slice(0, PICKER_MAIN_COUNT), ["fork", "pin", "hangingPiece", "backRankMate", "mateIn2", "discoveredAttack"]);
    assert.deepEqual(PICKER_THEMES.slice(PICKER_MAIN_COUNT), [
      "skewer",
      "capturingDefender",
      "trappedPiece",
      "sacrifice",
      "deflection",
      "attraction",
      "mateIn1",
      "mateIn3",
      "defensiveMove",
      "rookEndgame",
      "pawnEndgame",
    ]);
    for (const k of PICKER_THEMES) assert.notEqual(themeBit(k), null, k);
    assert.equal(themeGroup("fork"), "tactics");
    assert.equal(themeGroup("hangingPiece"), "material");
    assert.equal(themeGroup("mateIn2"), "mates");
    assert.equal(themeGroup("defensiveMove"), "defence");
    assert.equal(themeGroup("rookEndgame"), "endgames");
  });
});

describe("primaryTheme", () => {
  it("follows mates > fork > pin > skewer > discovered > double check > loose piece > trapped > remove the defender", () => {
    assert.equal(primaryTheme(["fork", "mateIn2", "middlegame", "short"]), "mateIn2");
    assert.equal(primaryTheme(["pin", "fork"]), "fork");
    assert.equal(primaryTheme(["skewer", "pin"]), "pin");
    assert.equal(primaryTheme(["discoveredAttack", "skewer"]), "skewer");
    assert.equal(primaryTheme(["hangingPiece", "doubleCheck"]), "doubleCheck");
    assert.equal(primaryTheme(["trappedPiece", "hangingPiece"]), "hangingPiece");
    assert.equal(primaryTheme(["capturingDefender", "trappedPiece"]), "trappedPiece");
    assert.equal(primaryTheme(["sacrifice", "capturingDefender"]), "capturingDefender");
  });

  it("puts tactics before rc:* before endgames before phases, and never picks a meta tag", () => {
    assert.equal(primaryTheme(["rc:recapture", "deflection"]), "deflection");
    assert.equal(primaryTheme(["rookEndgame", "rc:pawnStructure"]), "rc:pawnStructure");
    assert.equal(primaryTheme(["middlegame", "rookEndgame"]), "rookEndgame");
    assert.equal(primaryTheme(["advantage", "short", "crushing", "middlegame"]), "middlegame");
    assert.equal(primaryTheme(["advantage", "short", "oneMove"]), null);
    assert.equal(primaryTheme([]), null);
  });
});

describe("shard bitmask", () => {
  it("fits exact JSON numbers (≤ 53 bits) with unique keys", () => {
    assert.ok(SHARD_THEME_BITS.length <= 53);
    assert.equal(new Set(SHARD_THEME_BITS).size, SHARD_THEME_BITS.length);
  });

  it("keeps the first bits pinned (append-only: shards encode these numbers)", () => {
    assert.deepEqual(SHARD_THEME_BITS.slice(0, 6), ["fork", "pin", "skewer", "discoveredAttack", "doubleCheck", "hangingPiece"]);
    assert.equal(themeBit("veryLong"), 50);
  });

  it("never gives an rc:* key, mix or an unknown key a bit", () => {
    for (const k of Object.keys(THEMES).filter((k) => k.startsWith("rc:"))) assert.equal(themeBit(k), null, k);
    assert.equal(themeBit("mix"), null);
    assert.equal(themeBit("bodenMate"), null);
    assert.ok(SHARD_THEME_BITS.every((k) => !k.startsWith("rc:")));
    assert.equal(themeMask(["rc:recapture", "rc:pawnStructure"]), 0);
  });

  it("round-trips random theme sets, including the high bits", () => {
    const rnd = mulberry32(0xb175);
    for (let i = 0; i < 2_000; i++) {
      const keys = SHARD_THEME_BITS.filter(() => rnd() < 0.2);
      const mask = themeMask([...keys, "rc:recapture", ...keys]);
      assert.ok(Number.isSafeInteger(mask));
      assert.deepEqual(themesOfMask(mask), keys);
      for (const k of keys) assert.ok(maskHas(mask, k));
    }
    const all = themeMask(SHARD_THEME_BITS);
    assert.equal(all, 2 ** SHARD_THEME_BITS.length - 1);
    assert.deepEqual(themesOfMask(all), [...SHARD_THEME_BITS]);
    assert.throws(() => themesOfMask(-1));
    assert.throws(() => themesOfMask(2 ** 60));
  });

  it("is the bit table of the committed shard manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "puzzles/manifest.v1.json"), "utf8")) as { version: string; bits: Record<string, number> };
    assert.equal(manifest.version, "v1");
    assert.deepEqual(manifest.bits, shardBitsTable());
  });
});
