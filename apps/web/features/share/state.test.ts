// share/state.ts: the share screen's states (phase-03 plan §4.3) and the link helpers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shareFixture } from "@repo/contracts/http/fixtures/review";
import { controlsFor, displayLink, imageDownloadUrl, initialShareState, shareReducer, waitLabel, xIntentUrl } from "./state";

const share = shareFixture();

test("generating → created (image warming) → ready; copied lasts until reset", () => {
  let s = initialShareState(null, true);
  assert.equal(s.status, "generating");
  assert.deepEqual(controlsFor(s), { link: false, pgn: true, toggle: false, stop: false }, "Copy PGN works while generating");
  s = shareReducer(s, { type: "create" });
  assert.equal(s.busy, true);
  s = shareReducer(s, { type: "created", share });
  assert.equal(s.status, "generating", "the image still warms");
  assert.equal(shareReducer(initialShareState(null, true), { type: "image_ready" }).status, "generating", "no link, no ready");
  s = shareReducer(s, { type: "image_ready" });
  assert.equal(s.status, "ready");
  assert.deepEqual(controlsFor(s), { link: true, pgn: true, toggle: true, stop: true });
  s = shareReducer(s, { type: "copied" });
  assert.equal(s.copied, true);
  assert.equal(shareReducer(s, { type: "copy_reset" }).copied, false);
  assert.equal(shareReducer(initialShareState(null, true), { type: "copied" }).copied, false, "nothing to copy yet");
});

test("a seeded live link starts ready with its own username flag", () => {
  const s = initialShareState(shareFixture({ showUsername: false }), true);
  assert.deepEqual([s.status, s.showUsername], ["ready", false]);
});

test("errors: 5xx → error, 429 → rate_limited with the wait", () => {
  const busy = shareReducer(initialShareState(null, true), { type: "create" });
  assert.equal(shareReducer(busy, { type: "failed" }).status, "error");
  const rl = shareReducer(busy, { type: "rate_limited", retryAfterSec: 10_800 });
  assert.deepEqual([rl.status, rl.retryAfterSec, rl.busy], ["rate_limited", 10_800, false]);
  assert.equal(controlsFor(rl).link, false);
});

test("username toggle is optimistic and rolls back; stop sharing is optimistic and rolls back", () => {
  const ready = shareReducer(shareReducer(initialShareState(null, true), { type: "created", share }), { type: "image_ready" });
  const t = shareReducer(ready, { type: "toggle", showUsername: false });
  assert.deepEqual([t.showUsername, t.busy, controlsFor(t).toggle], [false, true, false]);
  const ok = shareReducer(t, { type: "toggled", share: shareFixture({ showUsername: false, imageVersion: 2 }) });
  assert.deepEqual([ok.showUsername, ok.share?.imageUrl.endsWith("?v=2"), ok.busy], [false, true, false]);
  assert.equal(shareReducer(t, { type: "toggle_failed", showUsername: true }).showUsername, true);
  const r = shareReducer(ready, { type: "revoke" });
  assert.equal(r.status, "revoked");
  assert.equal(controlsFor(r).pgn, false);
  assert.equal(shareReducer(r, { type: "revoke_failed" }).status, "ready");
});

test("helpers: the wait label, the X intent, the download URL and the shown link", () => {
  assert.equal(waitLabel(10_800), "3 h");
  assert.equal(waitLabel(3_601), "2 h");
  assert.equal(waitLabel(600), "10 min");
  assert.equal(waitLabel(45), "45 s");
  assert.equal(waitLabel(0), "1 s");
  assert.equal(xIntentUrl("My game", "https://playchess.tech/r/k7m2x9qa"), "https://x.com/intent/post?text=My+game&url=https%3A%2F%2Fplaychess.tech%2Fr%2Fk7m2x9qa");
  assert.equal(imageDownloadUrl(share.imageUrl), "https://playchess.tech/r/k7m2x9qa/og?v=1&download=1");
  assert.equal(imageDownloadUrl("https://x.test/og"), "https://x.test/og?download=1");
  assert.equal(displayLink(share.url), "playchess.tech/r/k7m2x9qa");
});
