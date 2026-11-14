import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { DestinationKey } from "../shell/types";
import {
  DESTINATIONS,
  backTarget,
  brandHref,
  childrenOf,
  destinationChords,
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
  for (const p of ["/game", "/play", "/games", "/analysis/abc", "/home", "/train", "/train/bank"]) assert.equal(hidesTabBar(p), false, p);
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
});

// P5 (phase-05 plan §4.8): the flag-gated destinations link to real pages once their flag is on.
test("every destination with every flag on has a page (Home, Train and its sections, Review)", () => {
  const patterns = pagePatterns();
  const exists = (href: string) => patterns.some((re) => re.test(href.split(/[?#]/)[0] || "/"));
  for (const d of enabledDestinations(ALL_ON)) assert.ok(exists(d.href(me)), `no app/**/page.tsx for ${d.key} (${d.href(me)})`);
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

// ── P5 (phase-05 plan §3.2, §4.8; WP-H): Home and Train ───────────────────────────────────────────────────────────

const ALL_ON = { "review-v3": true, home: true, train: true } as const;
const P5_ON = { home: true, train: true } as const;

test("Home and Train are off without their flags (no item, no tab, never current)", () => {
  for (const k of ["home", "train", "train-today", "bank", "puzzles"] as DestinationKey[]) {
    assert.ok(!enabledDestinations().some((d) => d.key === k), k);
    assert.ok(!enabledDestinations({ home: false, train: false }).some((d) => d.key === k), k);
  }
  for (const p of ["/home", "/train", "/train/bank", "/train/bank/session", "/train/puzzles", "/train/session/abc/summary"]) {
    assert.deepEqual(keys(currentDestinations(p, me)), [], p);
  }
  assert.deepEqual(keys(currentFromKey("bank")), []);
});

test("with home and train on: the six phone tabs in order, the Train sections as subs", () => {
  assert.deepEqual(
    tabBarDestinations(ALL_ON).map((d) => d.key),
    ["home", "play", "train", "learn", "review", "profile"],
  );
  assert.deepEqual(
    tabBarDestinations(P5_ON).map((d) => d.key),
    ["home", "play", "train", "learn", "profile"],
  );
  assert.deepEqual(
    childrenOf("train", P5_ON).map((d) => [d.key, d.label, d.href(me)]),
    [
      ["train-today", "Today", "/train"],
      ["bank", "Mistake Bank", "/train/bank"],
      ["puzzles", "Puzzles", "/train/puzzles"],
    ],
  );
  // Each flag switches only its own destinations on.
  assert.ok(enabledDestinations({ home: true }).some((d) => d.key === "home"));
  assert.ok(!enabledDestinations({ home: true }).some((d) => d.key === "train"));
  assert.ok(!enabledDestinations({ train: true }).some((d) => d.key === "home"));
});

test("Weakness (P6) stays hidden: no destination, no section, no chord", () => {
  for (const d of DESTINATIONS) {
    assert.doesNotMatch(d.href(me), /weakness/i, d.key);
    assert.doesNotMatch(d.label, /weakness/i, d.key);
  }
  assert.equal(subnavFor(currentDestinations("/train", me, P5_ON))?.items.some((d) => /weakness/i.test(d.label)), false);
});

test("Home and Train matching: sections by path segment, the hub owns its sessions", () => {
  const cur = (p: string) => keys(currentDestinations(p, me, P5_ON));
  assert.deepEqual(cur("/home"), ["home"]);
  assert.deepEqual(cur("/homes"), []);
  assert.deepEqual(cur("/train"), ["train", "train-today"]);
  assert.deepEqual(cur("/train/"), ["train", "train-today"]);
  assert.deepEqual(cur("/train/session/abc"), ["train", "train-today"]);
  assert.deepEqual(cur("/train/session/abc/summary?n=4"), ["train", "train-today"]);
  assert.deepEqual(cur("/train/bank"), ["bank", "train"]);
  assert.deepEqual(cur("/train/bank?view=all&theme=fork"), ["bank", "train"]);
  assert.deepEqual(cur("/train/bank/session?plan=1"), ["bank", "train"]);
  assert.deepEqual(cur("/train/puzzles?theme=pin"), ["puzzles", "train"]);
  assert.deepEqual(cur("/trainer"), []);
  assert.deepEqual(keys(currentFromKey("bank", P5_ON)), ["bank", "train"]);
  assert.deepEqual(keys(currentFromKey("home", P5_ON)), ["home"]);
});

test("subnavFor train: Today, Mistake Bank, Puzzles; each item current on its own pages", () => {
  const sub = subnavFor(currentDestinations("/train/bank", me, P5_ON));
  assert.equal(sub?.group, "train");
  assert.equal(sub?.label, "Train sections");
  assert.deepEqual(
    sub?.items.map((d) => d.key),
    ["train-today", "bank", "puzzles"],
  );
  const onBank = currentDestinations("/train/bank", me, P5_ON);
  assert.equal(isSubnavItemCurrent("bank", onBank), true);
  assert.equal(isSubnavItemCurrent("train-today", onBank), false);
  assert.equal(isSubnavItemCurrent("train-today", currentDestinations("/train", me, P5_ON)), true);
  assert.equal(subnavFor(currentDestinations("/home", me, P5_ON)), null);
});

test("the runners and a summary go back to Train and hide the phone tab bar; the hub and the bank are top-level", () => {
  const train = { key: "train", href: "/train", label: "Train" };
  assert.deepEqual(backTarget("/train/bank/session?s=abc", me), train);
  assert.deepEqual(backTarget("/train/puzzles", me), train);
  assert.deepEqual(backTarget("/train/puzzles?theme=fork", me), train);
  assert.deepEqual(backTarget("/train/session/abc/summary", me), train);
  assert.deepEqual(backTarget("/train/session/abc", me), train);
  for (const p of ["/train", "/train/bank", "/home", "/train/session"]) assert.equal(backTarget(p, me), null, p);
  assert.equal(hidesTabBar("/train/bank/session"), true);
  assert.equal(hidesTabBar("/train/bank/session?card=m_x"), true);
  assert.equal(hidesTabBar("/train/puzzles"), true);
  assert.equal(hidesTabBar("/train/session/abc/summary"), false, "the summary keeps the tab bar");
});

test("chords: G P and G L always; G R with review-v3; G H → /home and G M → the Mistake Bank with home / train", () => {
  assert.deepEqual(destinationChords(), { KeyP: "/play", KeyL: "/legends" });
  assert.deepEqual(destinationChords({ "review-v3": true }), { KeyP: "/play", KeyL: "/legends", KeyR: "/games" });
  assert.deepEqual(destinationChords(ALL_ON), { KeyH: "/home", KeyP: "/play", KeyM: "/train/bank", KeyL: "/legends", KeyR: "/games" });
  assert.equal(destination("bank").chord, "g m", "V3Shortcuts: Go to Mistake Bank G M");
  assert.equal(destination("home").chord, "g h");
  assert.equal(destination("train").chord, undefined, "P5 moved G M from Train to the Mistake Bank");
  // One chord per key among every destination.
  const used = DESTINATIONS.flatMap((d) => (d.chord ? [d.chord] : []));
  assert.equal(new Set(used).size, used.length);
});

test("the logo goes to /home with home on, to /play before", () => {
  assert.equal(brandHref(), "/play");
  assert.equal(brandHref({ home: false }), "/play");
  assert.equal(brandHref({ home: true }), "/home");
  assert.equal(brandHref({ train: true }), "/play");
});

test("reachability with every flag on: every enabled key in at most 2 activations, in every mode", () => {
  const enabled = enabledDestinations(ALL_ON).map((d) => d.key);
  for (const mode of ["sidebar", "rail", "tabbar"] as ShellMode[]) {
    for (const start of enabled) {
      const seen = new Map<DestinationKey, number>([[start, 0]]);
      let frontier: DestinationKey[] = [start];
      for (let step = 1; step <= 2; step += 1) {
        const next: DestinationKey[] = [];
        for (const k of frontier) {
          const href = destination(k).href(me);
          const isDetail = backTarget(href, me) !== null;
          for (const v of visibleKeys(mode, currentDestinations(href, me, ALL_ON), isDetail, ALL_ON)) {
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
