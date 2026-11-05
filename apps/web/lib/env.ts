// App environment helpers (SPEC D11). Read process.env.NEXT_PUBLIC_APP_ENV and
// process.env.NODE_ENV literally so Next inlines them at build time.

/** Inlined at build time: "dev" on replay-chess-dev, "production" on prod, "test" in the devices build, unset locally. */
export function appEnv(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): string | null {
  return value || null;
}

export function isProductionApp(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): boolean {
  return value === "production";
}

/** `/dev/**` fails closed: only dev and test builds, or local `next dev` with the variable unset. */
export function devRoutesEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return value === "dev" || value === "test" || (!value && nodeEnv === "development");
}

/** Test builds only (CI and the devices build): the client telemetry sink's guard (plan §11.6). Client-safe. */
export function isTestBuild(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): boolean {
  return value === "test";
}
