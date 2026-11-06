// Dev-only frame validation (P2 plan 13.1 G5; WP-C request): every server event is parsed against its zod schema
// from @repo/contracts/socket/registry and a mismatch is logged loudly. The schemas are loaded with a dynamic
// import behind a NODE_ENV check, so production game chunks never contain zod (acceptance: no `ZodError` in the
// `/game/[ref]` chunks).

export type FrameValidator = (event: string, payload: unknown) => void;

let loading: Promise<FrameValidator | null> | null = null;

export function loadFrameValidator(): Promise<FrameValidator | null> {
  // The condition must wrap the import() so webpack's constant folding drops the chunk from production builds.
  if (process.env.NODE_ENV !== "production") {
    loading ??= import("@repo/contracts/socket/registry")
      .then(({ SERVER_EVENTS, isServerEventName }) => {
        const validate: FrameValidator = (event, payload) => {
          if (!isServerEventName(event)) {
            console.error(`[realtime] unknown server event "${event}"`);
            return;
          }
          const result = SERVER_EVENTS[event].schema.safeParse(payload);
          if (!result.success) {
            console.error(`[realtime] "${event}" does not match its contract`, result.error.issues);
          }
        };
        return validate;
      })
      .catch(() => null);
  }
  return loading ?? Promise.resolve(null);
}
