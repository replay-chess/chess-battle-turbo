// The /home gate (phase-05 plan §4.1, §11), shared by the layout and the page. Layouts do not re-run on soft
// navigation, so the page repeats it; getViewer() and getFlags() are cache()'d, so the second call costs nothing.
//
// Signed out → /sign-in; not onboarded → /onboarding; not a member → /pricing?reason=…&redirect_url=/home (D-19
// default: lapsed members are not let in); `home` off → /play (the §13.4 rollback: members go back to Play).
import "server-only";
import { redirect } from "next/navigation";
import { pageGateRedirect } from "@/lib/auth/guards";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";
import { HOME_PATH } from "@/lib/home/landing";

export const HOME_FLAG_OFF_TARGET = "/play";

export async function homeGate(): Promise<Viewer> {
  const viewer = await getViewer();
  const target = pageGateRedirect(viewer, { returnTo: HOME_PATH });
  if (target) redirect(target);
  const flags = await getFlags(viewer);
  if (!flags.home) redirect(HOME_FLAG_OFF_TARGET);
  return viewer!;
}
