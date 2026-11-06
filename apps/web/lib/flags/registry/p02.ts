// Phase 2 feature flags (P2 plan §7.10). Client-safe data: no imports, no env reads. Both flags are removed at the
// P2 parity gate together with the legacy screen and the v1 socket handlers.
//
// Defaults are OFF everywhere: on dev they are turned on per user in PostHog (the owner and the E2E members A–P),
// and e2e runs turn them on with FLAGS_OVERRIDE ("game-v3:on,live-protocol-v2:on"). With either off, live human
// games render the legacy v1 screen (features/game/legacy). Bot games always use the v3 screen.

export const P02_FLAGS = {
  /** The v3 game screen (`GameScreen`) for live human games. Requires `live-protocol-v2`. */
  "game-v3": { default: { dev: false, test: false, production: false, local: false } },
  /** The client connects to the socket server with `proto: 2` (otherwise the v1 handlers). */
  "live-protocol-v2": { default: { dev: false, test: false, production: false, local: false } },
} as const;
