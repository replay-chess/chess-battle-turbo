// The `import-v3` gate of every accounts and import route (phase-04 plan §7.10): off → 404 `not_found`, as if the
// route did not exist. Evaluated per request through lib/flags (PostHog; FLAGS_OVERRIDE in e2e, test builds only);
// tests replace it with setImportFlag(). The Lichess start/callback evaluate it for the signed-in viewer only (a
// signed-out start is sent to sign-in first).
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";

export type ImportFlag = (viewer: Viewer) => Promise<boolean>;

const defaultImportFlag: ImportFlag = async (viewer) => {
  const { getFlags } = await import("@/lib/flags");
  return (await getFlags(viewer))["import-v3"];
};

let importFlag: ImportFlag = defaultImportFlag;

/** Test seam; returns a restore function. */
export function setImportFlag(next: ImportFlag): () => void {
  const previous = importFlag;
  importFlag = next;
  return () => {
    importFlag = previous;
  };
}

export function importEnabledFor(viewer: Viewer): Promise<boolean> {
  return importFlag(viewer);
}

/** Throws 404 `not_found` while `import-v3` is off for this viewer. */
export async function requireImportFlag(viewer: Viewer): Promise<void> {
  if (!(await importFlag(viewer))) throw new DataError("not_found");
}
