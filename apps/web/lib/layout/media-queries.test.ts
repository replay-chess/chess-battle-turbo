import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as mq from "./media-queries";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../../components/layout/viewport.css") + "\n" + read("../../app/globals.css");

for (const [name, value] of Object.entries(mq)) {
  if (name === "COARSE_POINTER_MQ") continue; // Tailwind's built-in pointer-coarse: variant
  test(`${name} appears verbatim in the CSS`, () => {
    assert.ok(css.includes(value), `${name} = "${value}" not found in viewport.css or globals.css`);
  });
}
