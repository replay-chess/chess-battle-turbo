import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import { buildReviewSnapshot } from "@/lib/services/analysis/share-snapshot";
import { SHARE_IMAGE_FALLBACK_FILENAME, shareCardInput, shareImageHeaders, shareImageTtlSec, SHARE_IMAGE_CDN_SEC } from "./card-input";
import { shareViewOf } from "./share-view";

describe("share image inputs and headers", () => {
  it("draws the moment's frame with its arrow and badge", () => {
    const s = buildReviewSnapshot(reviewFixture("done"), { showUsername: true });
    const view = shareViewOf(s);
    const input = shareCardInput(view);
    assert.equal(input.title, view.title);
    assert.equal(input.accuracy, view.accuracy.you);
    assert.equal(input.caption, s.moment?.caption);
    assert.deepEqual(input.board.arrow, s.moment?.arrow);
    assert.equal(input.board.fen, view.frames[view.startIndex]!.placement);
    assert.ok(input.board.badge?.icon.startsWith("/board_icons/svg/"));
    assert.equal(input.board.badge?.sq, view.frames[view.startIndex]!.last![1]);
  });

  it("live: 1 h in browsers, a CDN year under the share's tag", () => {
    const h = shareImageHeaders("ok", "k8qd2xab", false);
    assert.equal(h["Cache-Control"], "public, max-age=3600");
    assert.equal(h["Vercel-CDN-Cache-Control"], `public, s-maxage=${SHARE_IMAGE_CDN_SEC}`);
    assert.equal(h["Vercel-Cache-Tag"], "share:k8qd2xab");
    assert.equal(h["Content-Disposition"], undefined);
  });

  it("gone: 5 minutes everywhere and no tag (the generic card)", () => {
    const h = shareImageHeaders("gone", "k8qd2xab", false);
    assert.equal(h["Cache-Control"], "public, max-age=300");
    assert.equal(h["Vercel-CDN-Cache-Control"], "public, s-maxage=300");
    assert.equal(h["Vercel-Cache-Tag"], undefined);
  });

  it("?download=1 adds the attachment name", () => {
    assert.equal(shareImageHeaders("ok", "k8qd2xab", true)["Content-Disposition"], 'attachment; filename="replaychess-review-k8qd2xab.png"');
  });

  // regression: share-image-outlives-expiry (FIX-1). A live card was cached a year on the CDN whatever the share's
  // expiry, and nothing purges at expiry, so the board, names and caption stayed public long after the link expired.
  it("caps both TTLs at the share's expiry, and serves a share with no time left as gone", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const in10min = new Date(now + 600_000).toISOString();
    const soon = shareImageHeaders("ok", "k8qd2xab", false, { expiresAt: in10min, nowMs: now });
    assert.equal(soon["Cache-Control"], "public, max-age=600");
    assert.equal(soon["Vercel-CDN-Cache-Control"], "public, s-maxage=600");
    assert.equal(soon["Vercel-Cache-Tag"], "share:k8qd2xab");
    const in20days = new Date(now + 20 * 86_400_000).toISOString();
    const later = shareImageHeaders("ok", "k8qd2xab", false, { expiresAt: in20days, nowMs: now });
    assert.equal(later["Cache-Control"], "public, max-age=3600");
    assert.equal(later["Vercel-CDN-Cache-Control"], `public, s-maxage=${20 * 86_400}`);
    const expired = shareImageHeaders("ok", "k8qd2xab", false, { expiresAt: new Date(now - 1).toISOString(), nowMs: now });
    assert.equal(expired["Cache-Control"], "public, max-age=300");
    assert.equal(expired["Vercel-Cache-Tag"], undefined);
    assert.equal(shareImageTtlSec(null, now), null);
    assert.equal(shareImageTtlSec(in10min, now), 600);
  });

  // regression: share-image-filename-injection (FIX-1). The gone branch put the raw path segment into the
  // Content-Disposition filename, so a crafted code could break out of the quoted name.
  it("never echoes an invalid code into the download name", () => {
    const evil = `x"; filename*=UTF-8''evil.svg; x="`;
    assert.equal(shareImageHeaders("gone", evil, true)["Content-Disposition"], `attachment; filename="${SHARE_IMAGE_FALLBACK_FILENAME}"`);
    assert.equal(shareImageHeaders("ok", "K8QD2XAB", true)["Content-Disposition"], `attachment; filename="${SHARE_IMAGE_FALLBACK_FILENAME}"`);
    assert.equal(shareImageHeaders("gone", "k8qd2xab", true)["Content-Disposition"], 'attachment; filename="replaychess-review-k8qd2xab.png"');
  });
});
