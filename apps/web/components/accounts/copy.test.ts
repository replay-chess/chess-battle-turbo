// Connected-accounts copy (phase-04 plan §4.10, §4.11, §8.11): the strings the boards and the plan fix.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  closedCopy,
  deleteGamesLabel,
  disconnectedToast,
  formatCount,
  gamesImported,
  goneCopy,
  importingLabel,
  lichessErrorCopy,
  lichessLinkedToast,
  linkErrorCopy,
  mmss,
  notFoundCopy,
  rateLimitedCopy,
  ratingsLine,
  relativeTime,
  skippedCopy,
  sourceEmptyCopy,
  syncFailedCopy,
  syncFinishedToast,
} from "./copy";

const NOW = Date.parse("2026-11-10T09:30:00.000Z");
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

describe("numbers and clocks", () => {
  it("formats counts with separators and clamps", () => {
    assert.equal(formatCount(2000), "2,000");
    assert.equal(formatCount(12480), "12,480");
    assert.equal(formatCount(-3), "0");
    assert.equal(formatCount(4.6), "5");
  });
  it("m:ss rounds up and never goes negative", () => {
    assert.equal(mmss(30), "0:30");
    assert.equal(mmss(29.2), "0:30");
    assert.equal(mmss(90), "1:30");
    assert.equal(mmss(0), "0:00");
    assert.equal(mmss(-5), "0:00");
  });
  it("relative times follow 'Last sync …'", () => {
    assert.equal(relativeTime(ago(10), NOW), "just now");
    assert.equal(relativeTime(ago(60), NOW), "1 minute ago");
    assert.equal(relativeTime(ago(5 * 60), NOW), "5 minutes ago");
    assert.equal(relativeTime(ago(3600), NOW), "1 hour ago");
    assert.equal(relativeTime(ago(2 * 3600), NOW), "2 hours ago");
    assert.equal(relativeTime(ago(30 * 3600), NOW), "yesterday");
    assert.equal(relativeTime(ago(3 * 86400), NOW), "3 days ago");
    assert.equal(relativeTime("2026-10-03T12:00:00.000Z", NOW), "on Oct 3");
    assert.equal(relativeTime(ago(-60), NOW), "just now", "a clock skew into the future reads as now");
    assert.equal(relativeTime("not a date", NOW), "just now");
  });
});

describe("card lines", () => {
  it("ratings: the two pools with the most games, in pool order (the board's BLITZ 1179 · RAPID 1206)", () => {
    assert.equal(
      ratingsLine({ rapid: { rating: 1206, games: 180 }, blitz: { rating: 1179, games: 300 }, bullet: { rating: 871, games: 27 } }),
      "BLITZ 1179 · RAPID 1206",
    );
    assert.equal(ratingsLine({ blitz: { rating: 1402, games: 88 } }), "BLITZ 1402");
    assert.equal(ratingsLine({}), null);
  });
  it("import progress", () => {
    assert.equal(importingLabel(212, 480), "IMPORTING 212 / 480");
    assert.equal(importingLabel(1500, 2000), "IMPORTING 1,500 / 2,000");
    assert.equal(importingLabel(0, null), "IMPORTING 0 / …");
    assert.equal(gamesImported(1), "1 game imported");
    assert.equal(gamesImported(480), "480 games imported");
  });
});

describe("banners and errors (plan §4.10, §8.11)", () => {
  it("sync failed keeps the games safe and names the last good sync", () => {
    assert.equal(
      syncFailedCopy("chesscom", 480, ago(2 * 3600), NOW),
      "Chess.com didn’t respond. Your 480 imported games are safe; the last good sync was 2 hours ago.",
    );
    assert.equal(syncFailedCopy("lichess", 96, null, NOW), "Lichess didn’t respond. Your 96 imported games are safe.");
  });
  it("rate limited wraps the countdown", () => {
    const c = rateLimitedCopy("chesscom");
    assert.equal(`${c.before}0:28${c.after}`, "Chess.com is limiting requests. You can sync again in 0:28.");
  });
  it("skipped games say variants, unrated or unfinished (inv-acct Q19), never 'private'", () => {
    const s = skippedCopy(312, 480, 168);
    assert.equal(s, "We imported 312 of 480 games. 168 were skipped: variants, unrated or unfinished games.");
    assert.ok(!/private/i.test(s));
  });
  it("closed and vanished accounts", () => {
    assert.equal(closedCopy("chesscom", 480), "This Chess.com account was closed, so new games can't be imported. Your 480 imported games are safe.");
    assert.equal(goneCopy("chesscom", "knightowl_88"), "We couldn't find knightowl_88 on Chess.com. If you renamed your account, link it again.");
  });
  it("settings link errors (§7.3.3)", () => {
    assert.equal(notFoundCopy("knightowl_8"), "No Chess.com player called “knightowl_8”. Check the spelling; it is the name in your Chess.com profile link.");
    assert.equal(linkErrorCopy("profile_closed"), "This Chess.com account is closed, so its games can't be imported.");
    assert.match(linkErrorCopy("linked_elsewhere"), /another ReplayChess account/);
    assert.match(linkErrorCopy("already_linked"), /Disconnect it first/);
    assert.match(linkErrorCopy("upstream"), /didn't respond/);
  });
  it("Lichess OAuth return reasons", () => {
    for (const r of ["state", "upstream", "linked_elsewhere", "already_linked", "rate_limited", null]) {
      assert.match(lichessErrorCopy(r), /\.$/, String(r));
    }
    assert.match(lichessErrorCopy("linked_elsewhere"), /another ReplayChess account/);
    assert.match(lichessErrorCopy(null), /nothing was linked/);
  });
});

describe("toasts and confirm (the plan's exact copy)", () => {
  it("toasts", () => {
    assert.equal(syncFinishedToast(268), "Sync finished · 268 new games");
    assert.equal(syncFinishedToast(1), "Sync finished · 1 new game");
    assert.equal(lichessLinkedToast(96), "Lichess linked · importing 96 games");
    assert.equal(lichessLinkedToast(null), "Lichess linked · importing your games");
    assert.equal(disconnectedToast("chesscom", false), "Chess.com disconnected. Imported games kept.");
    assert.equal(disconnectedToast("chesscom", true), "Chess.com disconnected. Imported games are being removed.");
  });
  it("delete-games label", () => {
    assert.equal(deleteGamesLabel(480), "Also delete the 480 imported games and their reviews");
    assert.equal(deleteGamesLabel(1), "Also delete the 1 imported game and its review");
  });
  it("archive empty tab copy (§4.11)", () => {
    assert.equal(sourceEmptyCopy("chesscom", true), "No Chess.com games yet. They appear here as they import.");
    assert.equal(sourceEmptyCopy("lichess", false), "No Lichess games yet. Link your account to import them.");
  });
});
