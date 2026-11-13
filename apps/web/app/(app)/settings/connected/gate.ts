// The /settings/connected gate (phase-04 plan §4.10, §7.10, §11.1), shared by the layout and the page (layouts do not
// re-run on soft navigation; getViewer() and getFlags() are cache()'d, so the second call is free).
//
// Signed out → /sign-in (middleware already does it; this is the page's own guard). Signed-in non-members and
// non-onboarded viewers may open it (D4-17: linking works before the trial; the middleware lets them through).
// `import-v3` off → 404 (the page does not exist for them yet).
import "server-only";
import { notFound, redirect } from "next/navigation";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { getFlags } from "@/lib/flags";

export const CONNECTED_PATH = "/settings/connected";

export async function connectedGate(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent(CONNECTED_PATH)}`);
  const flags = await getFlags(viewer);
  if (!flags["import-v3"]) notFound();
  return viewer;
}
