import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withToast } from "./lazy-toast";

describe("withToast", () => {
  it("raises the toast once the library has loaded; a failed load is silent", async () => {
    const shown: string[] = [];
    const toast = { error: (m: string) => shown.push(m) } as unknown as typeof import("sonner").toast;
    await withToast((t) => t.error("Retry failed."), async () => ({ toast }));
    assert.deepEqual(shown, ["Retry failed."]);
    await withToast(() => assert.fail("must not run"), () => Promise.reject(new Error("chunk")));
  });
});
