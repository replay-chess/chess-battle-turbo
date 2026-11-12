// The /games gate (plan §11.1, §7.10), shared by the layout and the page. Layouts do not re-run on soft navigation,
// so the page repeats it; getViewer() and getFlags() are cache()'d, so the second call costs nothing.
//
// Signed out → /sign-in; not onboarded → /onboarding; not a member → /pricing?reason=… (lapsed members read only
// while `review-lapsed-read` is on, B26 / P3-Q1); `review-v3` off → 404 (the screen does not exist for them yet).
import "server-only";
import { notFound, redirect } from "next/navigation";
import { pageGateRedirect } from "@/lib/auth/guards";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";

export const GAMES_PATH = "/games";

export async function gamesGate(): Promise<Viewer> {
  const viewer = await getViewer();
  const flags = await getFlags(viewer);
  const target = pageGateRedirect(viewer, { returnTo: GAMES_PATH, allowLapsedRead: flags["review-lapsed-read"] });
  if (target) redirect(target);
  if (!flags["review-v3"]) notFound();
  return viewer!;
}
