// Lock-mode routes the layout suite checks on every matrix project (SPEC 10.6).
// `/dev/ui/shell` rows belong to P3's demo and stay red until it lands (SPEC 4.4).
export const ROUTES = [
  { path: "/dev/ui/stage?layout=game", board: true },
  { path: "/dev/ui/stage?layout=game&banner=payment", board: true },
  { path: "/dev/ui/stage?layout=hub", board: true },
  { path: "/dev/ui/stage?layout=list", board: false },
  { path: "/dev/ui/stage?layout=empty", board: false },
  { path: "/dev/ui/shell", board: false },
  { path: "/dev/ui/shell?content=list", board: false },
  { path: "/dev/ui/shell?content=empty&user=payment", board: false },
  { path: "/dev/ui/shell?current=legends", board: false }, // SubNav row in rail/tabbar
  { path: "/dev/ui/shell?back=legends&current=legends", board: false },
  // 1A·P7: V3PaymentFailed last_day (no dismiss; longer copy) and the V3Skeletons `game` composition.
  { path: "/dev/ui/shell?user=payment_last_day", board: false },
  { path: "/dev/ui/skeletons?variant=game", board: true },
] as const;

export type LayoutRoute = (typeof ROUTES)[number];

/** Game screens hide the tab bar; the BoardStage control bar replaces it. The game skeleton does the same. */
export const isGameRoute = (path: string) => /[?&](layout|variant)=game(&|$)/.test(path);

export const GAME_ROUTE = "/dev/ui/stage?layout=game";
export const HUB_ROUTE = "/dev/ui/stage?layout=hub";
export const LIST_ROUTE = "/dev/ui/stage?layout=list";
