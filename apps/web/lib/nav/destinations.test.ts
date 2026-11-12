import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { DestinationKey } from "../shell/types";
import {
  DESTINATIONS,
  backTarget,
  hidesTabBar,
  currentDestinations,
  currentFromKey,
  destination,
  enabledDestinations,
  isSubnavItemCurrent,
  subnavFor,
  tabBarDestinations,
  trialLabel,
  visibleKeys,
  type ShellMode,
} from "./destinations";

const me = { referenceId: "ref" };
const keys = (s: Set<DestinationKey>) => [...s].sort();

test("the enabled set is exactly play, tournaments, learn, legends, openings, profile", () => {
  assert.deepEqual(
    enabledDestinations()
      .map((d) => d.key)
      .sort(),
    ["learn", "legends", "openings", "play", "profile", "tournaments"],
  );
  assert.deepEqual(
    tabBarDestinations().map((d) => d.key),
    ["play", "learn", "profile"],
  );
});

test("hidden destinations carry no chord that the shell registers", () => {
  for (const d of DESTINATIONS.filter((x) => !x.enabled)) {
    assert.equal(currentDestinations(d.href(me), me).has(d.key), false, `${d.key} must never be current`);
  }
});

test("matching follows path segments exactly", () => {
  assert.deepEqual(keys(currentDestinations("/tournament/abc", me)), ["play", "tournaments"]);
  assert.deepEqual(keys(currentDestinations("/join-tournament/x", me)), ["play", "tournaments"]);
  assert.deepEqual(keys(currentDestinations("/join/x", me)), ["play"]);
  assert.deepEqual(keys(currentDestinations("/profile/other", me)), []);
  assert.deepEqual(keys(currentDestinations("/profile/ref", me)), ["profile"]);
  assert.deepEqual(keys(currentDestinations("/playlist", me)), []);
  assert.deepEqual(keys(currentDestinations("/play", me)), ["play"]);
  assert.deepEqual(keys(currentDestinations("/play/", me)), ["play"]);
  assert.deepEqual(keys(currentDestinations("/queue?time=300", me)), ["play"]);
  assert.deepEqual(keys(currentDestinations("/legends/morphy", me)), ["learn", "legends"]);
  assert.deepEqual(keys(currentDestinations("/openings", me)), ["learn", "openings"]);
  assert.deepEqual(keys(currentDestinations("/legendsx", me)), []);
});

test("currentFromKey adds the parent and ignores hidden keys", () => {
  assert.deepEqual(keys(currentFromKey("tournaments")), ["play", "tournaments"]);
  assert.deepEqual(keys(currentFromKey("legends")), ["learn", "legends"]);
  assert.deepEqual(keys(currentFromKey("home")), []);
  assert.deepEqual(keys(currentFromKey(null)), []);
});

test("subnavFor play and learn", () => {
  const play = subnavFor(currentDestinations("/play", me));
  assert.equal(play?.group, "play");
  assert.equal(play?.label, "Play sections");
  assert.deepEqual(
    play?.items.map((d) => d.key),
    ["play", "tournaments"],
  );
  const learn = subnavFor(currentDestinations("/openings/x", me));
  assert.equal(learn?.group, "learn");
  assert.equal(learn?.label, "Learn sections");
  assert.deepEqual(
    learn?.items.map((d) => d.key),
    ["legends", "openings"],
  );
  assert.equal(subnavFor(currentDestinations("/profile/ref", me)), null);
});

test("the SubNav Play item is current only when Tournaments isn't", () => {
  const onPlay = currentDestinations("/play", me);
  const onTournaments = currentDestinations("/tournaments", me);
  assert.equal(isSubnavItemCurrent("play", onPlay), true);
  assert.equal(isSubnavItemCurrent("play", onTournaments), false);
  assert.equal(isSubnavItemCurrent("tournaments", onTournaments), true);
});

test("backTarget for every detail pattern", () => {
  const back = (p: string) => backTarget(p, me);
  assert.deepEqual(back("/tournament/abc"), { key: "tournaments", href: "/tournaments", label: "Tournaments" });
  assert.deepEqual(back("/join-tournament/abc"), { key: "tournaments", href: "/tournaments", label: "Tournaments" });
  assert.deepEqual(back("/legends/morphy"), { key: "legends", href: "/legends", label: "Legends" });
  assert.deepEqual(back("/openings/sicilian"), { key: "openings", href: "/openings", label: "Openings" });
  for (const p of ["/queue", "/challenge/new", "/join/abc", "/position/abc", "/profile/other", "/game/abc"]) {
    assert.deepEqual(back(p), { key: "play", href: "/play", label: "Play" }, p);
  }
  for (const p of ["/play", "/legends", "/openings", "/tournaments", "/profile/ref", "/dev/ui/shell"]) {
    assert.equal(back(p), null, p);
  }
});

test("hidesTabBar: only a game route", () => {
  assert.equal(hidesTabBar("/game/abc"), true);
  for (const p of ["/game", "/play", "/games", "/analysis/abc"]) assert.equal(hidesTabBar(p), false, p);
});

test("reachability: every enabled key in at most 2 activations, in every mode", () => {
  const enabled = enabledDestinations().map((d) => d.key);
  for (const mode of ["sidebar", "rail", "tabbar"] as ShellMode[]) {
    for (const start of enabled) {
      // Arriving at a destination's href is never a detail route.
      const seen = new Map<DestinationKey, number>([[start, 0]]);
      let frontier: DestinationKey[] = [start];
      for (let step = 1; step <= 2; step += 1) {
        const next: DestinationKey[] = [];
        for (const k of frontier) {
          const href = destination(k).href(me);
          const isDetail = backTarget(href, me) !== null;
          for (const v of visibleKeys(mode, currentDestinations(href, me), isDetail)) {
            if (!seen.has(v)) {
              seen.set(v, step);
              next.push(v);
            }
          }
        }
        frontier = next;
      }
      for (const k of enabled) assert.ok(seen.has(k), `${mode}: ${k} unreachable from ${start} in 2 steps`);
    }
  }
});

test("on a phone detail route the SubNav hides (Back shows instead)", () => {
  const current = currentDestinations("/tournament/abc", me);
  assert.equal(visibleKeys("tabbar", current, true).has("tournaments"), false);
  assert.equal(visibleKeys("tabbar", current, false).has("tournaments"), true);
  assert.equal(visibleKeys("rail", current, true).has("tournaments"), true);
});

test("trialLabel rounds up and never says 0", () => {
  assert.equal(trialLabel(5), "Trial · 5 days left");
  assert.equal(trialLabel(1), "Trial · 1 day left");
  assert.equal(trialLabel(0.2), "Trial · 1 day left");
  assert.equal(trialLabel(0), "Trial · 1 day left");
  assert.equal(trialLabel(4.1), "Trial · 5 days left");
});

// Route existence: every link the shell renders has a page. Works before and after P4a's moves.
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function pagePatterns(): RegExp[] {
  const appDir = path.join(WEB, "app");
  const files = readdirSync(appDir, { recursive: true }) as string[];
  return files
    .filter((f) => /(^|[/\\])page\.tsx$/.test(f))
    .map((f) => {
      const segs = path
        .dirname(f)
        .split(/[/\\]/)
        .filter((s) => s && s !== "." && !/^\(.*\)$/.test(s))
        .map((s) =>
          /^\[\[?\.{3}.*\]\]?$/.test(s)
            ? ".+"
            : /^\[.*\]$/.test(s)
              ? "[^/]+"
              : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        );
      return segs.length ? new RegExp(`^/${segs.join("/")}$`) : /^\/$/;
    });
}

test("every enabled destination href and the account links have a page", () => {
  const patterns = pagePatterns();
  const exists = (href: string) => {
    const p = href.split(/[?#]/)[0] || "/";
    return patterns.some((re) => re.test(p));
  };
  const hrefs = [
    ...enabledDestinations().map((d) => d.href(me)),
    "/help",
    "/privacy",
    "/terms",
    "/admin",
    "/challenge/new",
    "/queue",
  ];
  for (const href of hrefs) assert.ok(exists(href), `no app/**/page.tsx for ${href}`);
  assert.equal(exists("/home"), false, "the /home route exists now: revisit the hidden Home destination");
});

test("Review (P3) is on only with review-v3: nav item, tab bar, current on /games, /review/* and /practice", () => {
  const on = { "review-v3": true } as const;
  assert.ok(!enabledDestinations().some((d) => d.key === "review"));
  assert.ok(!enabledDestinations({ "review-v3": false }).some((d) => d.key === "review"));
  assert.ok(enabledDestinations(on).some((d) => d.key === "review"));
  assert.deepEqual(
    tabBarDestinations(on).map((d) => d.key),
    ["play", "learn", "review", "profile"],
  );
  assert.equal(destination("review").href(me), "/games");
  assert.deepEqual(keys(currentDestinations("/games", me, on)), ["review"]);
  assert.deepEqual(keys(currentDestinations("/review/cm3k9x2p10007slzpqa8hd4fe", me, on)), ["review"]);
  assert.deepEqual(keys(currentDestinations("/games", me)), [], "never current with the flag off");
  assert.deepEqual(keys(currentDestinations("/reviews", me, on)), []);
  assert.deepEqual(keys(currentDestinations("/practice", me, on)), ["review"]);
  assert.deepEqual(keys(currentDestinations("/practices", me, on)), []);
});

test("a review is a full-screen detail: Back to My games, no phone tab bar", () => {
  assert.deepEqual(backTarget("/review/abc", me), { key: "review", href: "/games", label: "My Games" });
  assert.equal(hidesTabBar("/review/abc"), true);
  assert.equal(hidesTabBar("/review/abc/complete"), true);
  assert.equal(hidesTabBar("/games"), false);
  assert.equal(hidesTabBar("/game/abc"), true);
});

// regression: practice-phone-back (FIX-1): practice on phones and iPad portrait had no Back control.
test("practice is a detail with Back on phones (the game layout's top bar); the page names its origin", () => {
  assert.deepEqual(backTarget("/practice", me), { key: "review", href: "/games", label: "My Games" });
  assert.equal(backTarget("/practices", me), null);
});

// regression: review-back-wrong-target (FIX-2, review round 2). Every review sub-screen's Back said "Back to Review"
// and went to /games, so Compare on a phone had no way back to the review it came from.
test("a review's own screens go back to that review; the label names the target", () => {
  for (const sub of ["complete", "share", "legend"]) {
    assert.deepEqual(backTarget(`/review/cm3k9x2p10007slzpqa8hd4fe/${sub}`, me), {
      key: "review",
      href: "/review/cm3k9x2p10007slzpqa8hd4fe",
      label: "Review",
    });
  }
  assert.deepEqual(backTarget("/review/cm3k9x2p10007slzpqa8hd4fe/other", me), { key: "review", href: "/games", label: "My Games" });
});
