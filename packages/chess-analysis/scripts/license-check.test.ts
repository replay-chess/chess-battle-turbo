// The licence gate's rule (task A7): AGPL and GPL fail, LGPL and permissive licences pass, unknown licences fail.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { findings, FORBIDDEN, summary } from "./license-check";

const pkg = (name: string, license: string) => ({ name, versions: ["1.0.0"], license });

describe("license-check", () => {
  it("matches AGPL and GPL in every form, not LGPL", () => {
    for (const l of ["GPL-3.0", "GPL-2.0-only", "AGPL-3.0-or-later", "(MIT OR GPL-3.0)", "GPL", "agpl-3.0"]) {
      assert.ok(FORBIDDEN.test(l), l);
    }
    for (const l of ["MIT", "LGPL-3.0", "LGPL-2.1-or-later", "BSD-2-Clause", "Apache-2.0", "BlueOak-1.0.0", "ISC"]) {
      assert.ok(!FORBIDDEN.test(l), l);
    }
  });

  it("reports forbidden and unknown packages", () => {
    const json = {
      MIT: [pkg("a", "MIT")],
      "GPL-3.0": [pkg("stockfish-js", "GPL-3.0")],
      Unknown: [pkg("mystery", "Unknown")],
      "LGPL-3.0": [pkg("lib", "LGPL-3.0")],
    };
    assert.deepEqual(
      findings(json).map((f) => [f.name, f.reason]),
      [
        ["stockfish-js", "forbidden"],
        ["mystery", "unknown"],
      ],
    );
    assert.equal(summary(json), "MIT 1, GPL-3.0 1, Unknown 1, LGPL-3.0 1");
  });

  it("passes the grading library's own tree (chess.js, BSD-2-Clause)", () => {
    assert.deepEqual(findings({ "BSD-2-Clause": [pkg("chess.js", "BSD-2-Clause")] }), []);
  });
});
