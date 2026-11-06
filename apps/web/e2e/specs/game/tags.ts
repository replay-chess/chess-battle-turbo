// Design-state tags of the P2 game boards (phase-02 plan 12.6 "State coverage report"; docs/qa/README.md).
//
// The 33 P2 boards are one screen in 55 states, drawn per device and per highlighted default state: the 19 desktop
// boards (V3Game and its variants), three per tablet/phone family, V3GamePrototype and V3MoveBoard. A spec that
// reaches a state on desktop reaches it on every desktop board of that state; the device suites tag the family they
// render. `gameTags("state", ["over_resign_win"])` → `@state:V3Game.over_resign_win @state:V3GameBot.… …`.

export const DESKTOP_BOARDS = [
  "V3Game",
  "V3GameBot",
  "V3GameCheck",
  "V3GameDrawOffer",
  "V3GameIllegal",
  "V3GameLowTime",
  "V3GameOppDisconnected",
  "V3GameOver",
  "V3GameOverDraw",
  "V3GameOverLoss",
  "V3GameOverTimeout",
  "V3GamePremove",
  "V3GamePromotion",
  "V3GameReconnecting",
  "V3GameResign",
  "V3GameTheirMove",
  "V3RematchOffer",
  "V3Spectate",
  "V3StudyPhase",
] as const;

export const DEVICE_BOARDS = {
  desktop: DESKTOP_BOARDS,
  "ipad-landscape": ["V3iPadLGame", "V3iPadLGameDrawOffer", "V3iPadLGameOver"],
  "ipad-portrait": ["V3iPadPGame", "V3iPadPGameDrawOffer", "V3iPadPGameOver"],
  iphone: ["V3iPhoneGame", "V3iPhoneGameDrawOffer", "V3iPhoneGameOver"],
  android: ["V3AndroidGame", "V3AndroidGameDrawOffer", "V3AndroidGameOver"],
} as const;

export type DeviceFamily = keyof typeof DEVICE_BOARDS;

/** Playwright `tag` entries for the states a test reaches (`@state` real data, `@demo` on /dev/ui/game). */
export function gameTags(kind: "state" | "demo", states: readonly string[], family: DeviceFamily = "desktop"): string[] {
  return states.flatMap((s) => DEVICE_BOARDS[family].map((b) => `@${kind}:${b}.${s}`));
}

/** Common tags of every P2 game spec. */
export function p2(...extra: string[]): string[] {
  return ["@p2", ...extra];
}
