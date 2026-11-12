import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buttonVariants } from "@/components/ui/button";
import { PRIMARY_LINK } from "./primary-link";

describe("server link styles", () => {
  it("carry every class of the DS primary button (bar the disabled states a link never has)", () => {
    const have = new Set(PRIMARY_LINK.split(/\s+/));
    const want = buttonVariants({ variant: "primary" })
      .split(/\s+/)
      .filter((c) => !/disabled|aria-disabled/.test(c));
    assert.deepEqual(want.filter((c) => !have.has(c)), []);
  });
});
