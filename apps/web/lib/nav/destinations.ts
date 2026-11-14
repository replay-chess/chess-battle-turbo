// Single source of truth for the app shell's destinations (SPEC 8.2; 03 §6.2).
// Sidebar, rail, tab bar, SubNav, Back, the palette and the chords all read it.
import { BookOpen, Crosshair, House, Play, RotateCcw, Settings, UserRound, type LucideIcon } from "lucide-react";
import type { FlagKey } from "../flags/registry";
import type { DestinationKey } from "../shell/types";

export type Me = { referenceId: string };

export type Destination = {
  key: DestinationKey;
  /** Title Case. */
  label: string;
  href: (me: Me) => string;
  /** Top-level destinations only; subs render as text links. */
  icon?: LucideIcon;
  parent?: DestinationKey;
  /** "g p" */
  chord?: string;
  match: (pathname: string, me: Me) => boolean;
  /** Phase 1: static. Hidden destinations appear nowhere. */
  enabled: boolean;
  /** A destination behind a feature flag is enabled when the flag is on for the viewer (P3: Review, `review-v3`). */
  flag?: FlagKey;
  showInTabBar: boolean;
};

/** The viewer's flags that switch destinations on (the shell reads them with useFlag()). */
export type NavFlags = Partial<Record<FlagKey, boolean>>;

/** A destination is on when it is enabled, or when its flag is on for this viewer. */
export function isEnabled(d: Destination, flags?: NavFlags): boolean {
  return d.enabled || (d.flag !== undefined && flags?.[d.flag] === true);
}

export type ShellMode = "sidebar" | "rail" | "tabbar";

/** Strips the query, hash and trailing slash. */
export function normalizePath(pathname: string): string {
  const bare = pathname.split(/[?#]/)[0] || "/";
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

/** Exact segment match: `/play` matches `/play` and `/play/x`, never `/playlist`. */
function under(pathname: string, base: string): boolean {
  const p = normalizePath(pathname);
  return p === base || p.startsWith(`${base}/`);
}

/** `/join/x` style: the base plus at least one more segment. */
function detailOf(pathname: string, base: string): boolean {
  const p = normalizePath(pathname);
  return p.startsWith(`${base}/`) && p.length > base.length + 1;
}

const never = () => false;

function matchesTournaments(pathname: string): boolean {
  return under(pathname, "/tournaments") || under(pathname, "/tournament") || under(pathname, "/join-tournament");
}

function isOwnProfile(pathname: string, me: Me): boolean {
  return Boolean(me.referenceId) && under(pathname, `/profile/${encodeURIComponent(me.referenceId)}`);
}

export const DESTINATIONS: Destination[] = [
  {
    key: "home",
    label: "Home",
    href: () => "/home",
    icon: House,
    chord: "g h",
    match: (p) => under(p, "/home"),
    enabled: false,
    // P5 (phase-05 plan §4.8): the member landing, behind `home`.
    flag: "home",
    showInTabBar: true,
  },
  {
    key: "play",
    label: "Play",
    href: () => "/play",
    icon: Play,
    chord: "g p",
    match: (p) =>
      under(p, "/play") ||
      under(p, "/queue") ||
      under(p, "/challenge") ||
      under(p, "/join") ||
      under(p, "/position") ||
      matchesTournaments(p),
    enabled: true,
    showInTabBar: true,
  },
  {
    key: "tournaments",
    label: "Tournaments",
    href: () => "/tournaments",
    parent: "play",
    match: (p) => matchesTournaments(p),
    enabled: true,
    showInTabBar: false,
  },
  {
    // P5 (phase-05 plan §3.2, §4.8): Train and its sections (Today, Mistake Bank, Puzzles), behind `train`. The P1 table
    // bound G then M to Train; P5 moves it to the Mistake Bank as V3Shortcuts says ("Go to Mistake Bank G M"). The
    // Weakness Profile section is P6's and stays out until then.
    key: "train",
    label: "Train",
    href: () => "/train",
    icon: Crosshair,
    match: (p) => under(p, "/train"),
    enabled: false,
    flag: "train",
    showInTabBar: true,
  },
  {
    key: "train-today",
    label: "Today",
    href: () => "/train",
    parent: "train",
    // The hub and its session pages (redirect and summary); the bank and puzzles have their own items.
    match: (p) => normalizePath(p) === "/train" || under(p, "/train/session"),
    enabled: false,
    flag: "train",
    showInTabBar: false,
  },
  {
    key: "bank",
    label: "Mistake Bank",
    href: () => "/train/bank",
    parent: "train",
    chord: "g m",
    match: (p) => under(p, "/train/bank"),
    enabled: false,
    flag: "train",
    showInTabBar: false,
  },
  {
    key: "puzzles",
    label: "Puzzles",
    href: () => "/train/puzzles",
    parent: "train",
    match: (p) => under(p, "/train/puzzles"),
    enabled: false,
    flag: "train",
    showInTabBar: false,
  },
  {
    key: "learn",
    label: "Learn",
    href: () => "/legends",
    icon: BookOpen,
    match: (p) => under(p, "/legends") || under(p, "/openings"),
    enabled: true,
    showInTabBar: true,
  },
  {
    key: "legends",
    label: "Legends",
    href: () => "/legends",
    parent: "learn",
    chord: "g l",
    match: (p) => under(p, "/legends"),
    enabled: true,
    showInTabBar: false,
  },
  {
    key: "openings",
    label: "Openings",
    href: () => "/openings",
    parent: "learn",
    match: (p) => under(p, "/openings"),
    enabled: true,
    showInTabBar: false,
  },
  {
    // P3 (plan §1 item 6): Review opens My Games; a review itself is a detail of it. Behind `review-v3`.
    // Practice (§4.8) is reached from a review, Compare or the game-over card in P3, so it stays under Review.
    key: "review",
    label: "Review",
    href: () => "/games",
    icon: RotateCcw,
    chord: "g r",
    match: (p) => under(p, "/games") || under(p, "/review") || under(p, "/practice"),
    enabled: false,
    flag: "review-v3",
    showInTabBar: true,
  },
  {
    key: "profile",
    label: "Profile",
    href: (me) => `/profile/${encodeURIComponent(me.referenceId)}`,
    icon: UserRound,
    match: isOwnProfile,
    enabled: true,
    showInTabBar: true,
  },
  {
    key: "settings",
    label: "Settings",
    href: () => "/settings",
    icon: Settings,
    match: never,
    enabled: false,
    showInTabBar: false,
  },
];

const BY_KEY = new Map(DESTINATIONS.map((d) => [d.key, d]));

export function destination(key: DestinationKey): Destination {
  const d = BY_KEY.get(key);
  if (!d) throw new Error(`Unknown destination ${key}`);
  return d;
}

export function enabledDestinations(flags?: NavFlags): Destination[] {
  return DESTINATIONS.filter((d) => isEnabled(d, flags));
}

/** Enabled top-level destinations, in nav order (Play, Learn, Profile; Review with `review-v3`). */
export function topLevelDestinations(flags?: NavFlags): Destination[] {
  return enabledDestinations(flags).filter((d) => !d.parent);
}

/** Enabled subs of a parent, in nav order. */
export function childrenOf(parent: DestinationKey, flags?: NavFlags): Destination[] {
  return enabledDestinations(flags).filter((d) => d.parent === parent);
}

export function tabBarDestinations(flags?: NavFlags): Destination[] {
  return enabledDestinations(flags).filter((d) => d.showInTabBar);
}

/** Every enabled destination that matches; a matching child also makes its parent current. */
export function currentDestinations(pathname: string, me: Me, flags?: NavFlags): Set<DestinationKey> {
  const out = new Set<DestinationKey>();
  for (const d of enabledDestinations(flags)) {
    if (!d.match(pathname, me)) continue;
    out.add(d.key);
    if (d.parent) out.add(d.parent);
  }
  return out;
}

/** The current set for an explicit key (demo routes): the key plus its parent. */
export function currentFromKey(key: DestinationKey | null, flags?: NavFlags): Set<DestinationKey> {
  const out = new Set<DestinationKey>();
  if (!key) return out;
  const d = BY_KEY.get(key);
  if (!d || !isEnabled(d, flags)) return out;
  out.add(d.key);
  if (d.parent) out.add(d.parent);
  return out;
}

export type SubnavGroup = { group: "play" | "learn" | "train"; label: string; items: Destination[] };

/** The Train sections (Today, Mistake Bank, Puzzles). Train is current only while `train` is on, and so are they. */
function trainSections(): Destination[] {
  return DESTINATIONS.filter((d) => d.parent === "train");
}

export function subnavFor(current: Set<DestinationKey>): SubnavGroup | null {
  if (current.has("play"))
    return { group: "play", label: "Play sections", items: [destination("play"), ...childrenOf("play")] };
  if (current.has("learn")) return { group: "learn", label: "Learn sections", items: childrenOf("learn") };
  if (current.has("train")) return { group: "train", label: "Train sections", items: trainSections() };
  return null;
}

/** SubNav current state: the Play item is current only when Tournaments isn't. */
export function isSubnavItemCurrent(key: DestinationKey, current: Set<DestinationKey>): boolean {
  if (key === "play") return current.has("play") && !current.has("tournaments");
  return current.has(key);
}

export type BackTarget = { key: DestinationKey; href: string; label: string };

export function backFor(key: DestinationKey, me: Me): BackTarget {
  const d = destination(key);
  return { key, href: d.href(me), label: d.label };
}

/** Phone detail routes show Back instead of the brand (C H5). */
export function backTarget(pathname: string, me: Me): BackTarget | null {
  const p = normalizePath(pathname);
  if (detailOf(p, "/tournament") || detailOf(p, "/join-tournament")) return backFor("tournaments", me);
  if (detailOf(p, "/legends")) return backFor("legends", me);
  if (detailOf(p, "/openings")) return backFor("openings", me);
  if (
    under(p, "/queue") ||
    under(p, "/challenge/new") ||
    detailOf(p, "/join") ||
    detailOf(p, "/position") ||
    detailOf(p, "/game")
  ) {
    return backFor("play", me);
  }
  if (detailOf(p, "/profile") && !isOwnProfile(p, me)) return backFor("play", me);
  // A review's own screens (complete, share, the legend comparison) go back to that review; the review itself goes back
  // to My games. Each label names where the link goes (WCAG 2.4.4; regression: review-back-wrong-target, FIX-2).
  const reviewSub = REVIEW_SUBSCREEN.exec(p);
  if (reviewSub) return { key: "review", href: `/review/${reviewSub[1]}`, label: "Review" };
  if (detailOf(p, "/review")) return MY_GAMES_BACK;
  // Practice (P3 plan §4.8): phones and iPad portrait use the game layout, whose top bar has Back (FIX-1). The path
  // alone does not say where practice came from, so this is My games; the page names its real origin (the review,
  // the comparison, the position) with ShellBackOverride.
  if (under(p, "/practice")) return MY_GAMES_BACK;
  // P5 (phase-05 plan §3.2): the runners and a session's summary go back to Train (the hub).
  if (under(p, "/train/bank/session") || under(p, "/train/puzzles") || detailOf(p, "/train/session")) return backFor("train", me);
  return null;
}

/** `/review/<ref>/(complete|share|legend)`: a screen of one review. */
const REVIEW_SUBSCREEN = /^\/review\/([^/]+)\/(?:complete|share|legend)$/;
/** Back from a review (or from practice of unknown origin): My games, the Review section's landing. */
const MY_GAMES_BACK: BackTarget = { key: "review", href: "/games", label: "My Games" };

/**
 * Routes that take the whole phone screen: no tab bar while a game (P2 plan 4.1), a review (P3 plan §4.1, the
 * review's own control bar) or a training runner (P5 plan §4: the runner's own control bar; the plan's "immersive"
 * group) is on screen, one viewport.
 */
export function hidesTabBar(pathname: string): boolean {
  const p = normalizePath(pathname);
  return detailOf(p, "/game") || detailOf(p, "/review") || under(p, "/train/bank/session") || under(p, "/train/puzzles");
}

/**
 * Which enabled destinations a user can activate in one step, given the shell
 * mode and the current set (used by the reachability test).
 * - sidebar: top level + Tournaments always + the subs of the current Learn or Train.
 * - rail: top level + SubNav (subs of the current group).
 * - tabbar: tab items + SubNav, except on detail routes (Back shows instead).
 */
export function visibleKeys(mode: ShellMode, current: Set<DestinationKey>, isDetail: boolean, flags?: NavFlags): Set<DestinationKey> {
  const out = new Set<DestinationKey>();
  const top = mode === "tabbar" ? tabBarDestinations(flags) : topLevelDestinations(flags);
  for (const d of top) out.add(d.key);
  if (mode === "sidebar") {
    for (const d of childrenOf("play", flags)) out.add(d.key);
    if (current.has("learn")) for (const d of childrenOf("learn", flags)) out.add(d.key);
    if (current.has("train")) for (const d of childrenOf("train", flags)) out.add(d.key);
    return out;
  }
  const sub = subnavFor(current);
  if (sub && !(mode === "tabbar" && isDetail)) for (const d of sub.items) out.add(d.key);
  return out;
}

/**
 * Where the logo goes (P5 plan §4.8): Home once `home` is on for the viewer, else Play (the Phase 1 shell home).
 */
export function brandHref(flags?: NavFlags): string {
  return isEnabled(destination("home"), flags) ? "/home" : "/play";
}

/**
 * The G chords of the enabled destinations, as the chord machine takes them (`{ KeyH: "/home" }`): G then P and G then
 * L always; G then R with `review-v3`; G then H and G then M (Mistake Bank) with `home` / `train` (P5, V3Shortcuts).
 */
export function destinationChords(flags?: NavFlags): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of enabledDestinations(flags)) {
    const m = d.chord ? /^g ([a-z])$/.exec(d.chord) : null;
    if (m) out[`Key${m[1]!.toUpperCase()}`] = d.href({ referenceId: "" });
  }
  return out;
}

/** Demo and preview routes turn hrefs built from the referenceId into hashes (no 404 links). */
export function destinationHref(d: Destination, me: Me, opts: { demo?: boolean; preview?: boolean } = {}): string {
  if (opts.preview) return `#${d.key}`;
  if (opts.demo && d.key === "profile") return "#profile";
  return d.href(me);
}

export function membershipHref(me: Me, demo = false): string {
  return demo ? "#membership" : `/profile/${encodeURIComponent(me.referenceId)}#membership`;
}

/** "Trial · 5 days left" / "Trial · 1 day left". Days are rounded up and never 0 (C §6). */
export function trialLabel(daysLeft: number): string {
  const days = Math.max(1, Math.ceil(daysLeft));
  return `Trial · ${days} ${days === 1 ? "day" : "days"} left`;
}
