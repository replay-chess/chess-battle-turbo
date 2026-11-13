// DODO_API_BASE_URL (phase-04 plan 7.9, D4-19; interface-check 4.1): test builds point the Dodo REST client at the
// local upstream mock (`http://localhost:4010/dodo`). Any other environment must talk to Dodo itself, so the override
// is REFUSED (thrown, never silently ignored) unless the app env is `test`. Unset → null (the SDK's own base URL for
// test_mode / live_mode). Pure: the env object is passed in.
//
// The interface check names `lib/env-providers.ts` as the shared home of the provider base-URL guards (WP-C's
// `providerBaseUrls`); this module is WP-D's half and is re-exported from there.

type Env = Readonly<Record<string, string | undefined>>;

export class DodoBaseUrlRefusedError extends Error {
  constructor(reason: string) {
    super(`DODO_API_BASE_URL refused: ${reason}`);
    this.name = "DodoBaseUrlRefusedError";
  }
}

/** The app env the guard reads: `APP_ENV` (server) or `NEXT_PUBLIC_APP_ENV` (the web's name for it). */
function appEnvOf(env: Env): string | undefined {
  return env.APP_ENV?.trim() || env.NEXT_PUBLIC_APP_ENV?.trim() || undefined;
}

/** The Dodo REST base URL override, or null. Throws DodoBaseUrlRefusedError outside `APP_ENV=test` or on a bad URL. */
export function dodoApiBaseUrl(env: Env = process.env): string | null {
  const raw = env.DODO_API_BASE_URL?.trim();
  if (!raw) return null;
  const app = appEnvOf(env);
  if (app !== "test") throw new DodoBaseUrlRefusedError(`only a test build may override the Dodo API (app env "${app ?? "unset"}")`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DodoBaseUrlRefusedError("not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new DodoBaseUrlRefusedError("not http(s)");
  return raw.replace(/\/+$/, "");
}
