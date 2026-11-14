// The browser subpaths stay browser-safe (phase-05 plan §8 intro, §9.5; WP-B acceptance): `/grade`, `/labels`,
// `/items` (and `/rating`, the puzzle-rating preview) reach no ts-fsrs, no Node built-in, no Prisma and no database
// package through any import, static or dynamic, transitively — including the npm packages they pull in (sqids) and
// the workspace module they share (`@repo/game-core/rating`). `/labels`, `/grade` and `/items` also stay free of
// chess.js (the non-board routes' budget). The barrel is the server's: it does reach ts-fsrs, which shows the walk
// sees through re-exports. The graph is read with the TypeScript pre-processor, so a dynamic `import("…")` counts too.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = dirname(fileURLToPath(import.meta.url));
const GAME_CORE = resolve(SRC, "../../game-core/src");
const require = createRequire(import.meta.url);
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

interface Graph {
  files: Set<string>;
  packages: Set<string>;
}

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.js`, resolve(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next form
    }
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** Every file and bare package the entry reaches. Workspace modules and sqids are walked into; the rest are leaves. */
function walk(entry: string): Graph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const ref of info.importedFiles) {
      const spec = ref.fileName;
      if (spec.startsWith(".")) {
        queue.push(resolveRelative(file, spec));
      } else if (spec === "@repo/game-core/rating") {
        queue.push(resolve(GAME_CORE, "rating/index.ts"));
      } else if (spec === "sqids") {
        packages.add(spec);
        // Walk the ESM build the browser bundle would include.
        queue.push(require.resolve("sqids").replace(/cjs\/sqids\.js$/, "esm/sqids.js"));
      } else {
        packages.add(spec);
      }
    }
  }
  return { files, packages };
}

const forbidden = (pkg: string) => pkg === "ts-fsrs" || pkg.startsWith("ts-fsrs/") || NODE_BUILTINS.has(pkg) || pkg.startsWith("node:") || pkg.startsWith("@prisma/") || pkg === "@repo/db" || pkg.startsWith("@repo/db/");

describe("browser subpaths", () => {
  for (const sub of ["grade", "labels", "items", "rating"]) {
    it(`@repo/chess-training/${sub} reaches no ts-fsrs, Node built-in, Prisma or database package`, () => {
      const g = walk(resolve(SRC, `${sub}.ts`));
      const bad = [...g.packages].filter(forbidden);
      assert.deepEqual(bad, [], `${sub} imports ${bad.join(", ")} (files: ${[...g.files].map((f) => f.replace(SRC, "src")).join(", ")})`);
      for (const f of g.files) assert.ok(!f.endsWith("/fsrs.ts") && !f.endsWith("/session.ts"), `${sub} reaches ${f}`);
    });
  }

  for (const sub of ["grade", "labels", "items"]) {
    it(`@repo/chess-training/${sub} stays off chess.js (non-board routes)`, () => {
      assert.ok(!walk(resolve(SRC, `${sub}.ts`)).packages.has("chess.js"));
    });
  }

  it("the walk does see ts-fsrs through the server barrel (the check is not vacuous)", () => {
    const g = walk(resolve(SRC, "index.ts"));
    assert.ok(g.packages.has("ts-fsrs"));
    assert.ok([...g.files].some((f) => f.endsWith("/fsrs.ts")));
  });

  it("the walk follows dynamic imports", () => {
    const info = ts.preProcessFile('const m = await import("ts-fsrs");', true, true);
    assert.deepEqual(info.importedFiles.map((f) => f.fileName), ["ts-fsrs"]);
  });

  it("the subpaths load and work without ts-fsrs in the module graph", async () => {
    const grade = await import("./grade");
    const labels = await import("./labels");
    const items = await import("./items");
    const rating = await import("./rating");
    assert.equal(grade.suggestedGrade({ shown: false, wrongs: 0, hints: 1 }), "hard");
    assert.equal(labels.intervalLabel(4), "4 days");
    assert.equal(items.decodeMistakeItemKey(items.mistakeItemKey(-7n)), -7n);
    assert.equal(rating.seedPuzzleRating({ blitz: 1184 }).r, 1484);
  });
});
