// Server-only read of the viewer for the (app) layout (SPEC 9.3). Since 1B·J it reads the one viewer statement
// (`getViewerRecord()`, lib/auth/viewer.ts, React cache()), so the layout, getViewer() and the qk.me() seed share a
// single DB statement per render. `toShellSession` stays the pure mapping.
import { cache } from "react";
import { getViewerRecord, toShellUserRecord, viewerOptions } from "@/lib/auth/viewer";
import { toShellSession, type ShellSession } from "./shell-user";
import type { ChromeMode } from "./types";

/**
 * The signed-in viewer's shell data, or null when signed out, inactive, or when Clerk can't provision the user
 * yet. Null means marketing chrome. Memoised per request with React `cache()`; `now` is x-rc-now aware.
 */
export const getShellSession = cache(async (): Promise<ShellSession | null> => {
  const record = await getViewerRecord();
  if (!record) return null;
  return toShellSession(toShellUserRecord(record), await viewerOptions());
});

/**
 * The (app) chrome (SPEC D2, plan §7.10): the app shell for members while the `shell-v3` flag is on, the page's
 * own marketing Navbar and Footer otherwise (signed out, non-members, and everyone with the flag off).
 */
export function chromeModeFor(session: Pick<ShellSession, "member"> | null, flags: { "shell-v3": boolean }): ChromeMode {
  return session?.member && flags["shell-v3"] ? "shell" : "marketing";
}
