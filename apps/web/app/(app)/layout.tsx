import { AppShellView } from "@/components/shell/AppShellView";
import { ChromeProvider } from "@/components/shell/chrome-context";
import { getShellSession } from "@/lib/shell/get-shell-session";
import type { ChromeMode } from "@/lib/shell/types";

// Picks the chrome once per render (SPEC D2): members get the app shell,
// everyone else gets the page's own marketing Navbar and Footer. Never redirects:
// the public catalogue pages (legends, openings, profile) live here too.
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getShellSession();
  const mode: ChromeMode = session?.member ? "shell" : "marketing";
  return (
    <ChromeProvider mode={mode}>
      {mode === "shell" && session ? <AppShellView user={session.user}>{children}</AppShellView> : children}
    </ChromeProvider>
  );
}
