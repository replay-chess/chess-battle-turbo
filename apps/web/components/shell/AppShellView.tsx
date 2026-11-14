"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { navSurface, trackShell } from "@/lib/analytics/shell-events";
import { useFlag } from "@/lib/flags/client";
import {
  backFor,
  backTarget,
  currentDestinations,
  currentFromKey,
  hidesTabBar,
  subnavFor,
  type BackTarget,
  type NavFlags,
} from "@/lib/nav/destinations";
import { useBackOverride } from "./back-override";
import { markShellMounted } from "@/lib/shell/presence";
import type { DestinationKey, ShellUser } from "@/lib/shell/types";
import { CommandPalette } from "./CommandPalette";
import { OnlineChip } from "./OnlineChip";
import { RouteHairline } from "./RouteHairline";
import { ShellBanners } from "./ShellBanners";
import { Sidebar } from "./Sidebar";
import { SubNav } from "./SubNav";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";
import { useShellKeys } from "./useShellKeys";

// The `?` list loads on first open (its tables are lib/shell/shortcuts.ts): no route pays for it on first load.
const ShortcutsDialog = dynamic(() => import("./ShortcutsDialog").then((m) => m.ShortcutsDialog), { ssr: false });

export type AppShellViewProps = {
  user: ShellUser;
  children: React.ReactNode;
  /** Game screens: no phone tab bar (the BoardStage footer replaces it). Default false. */
  hideTabBar?: boolean;
  /** /dev routes: Clerk actions disabled, analytics off, hairline off, profile hrefs become hashes. */
  demo?: boolean;
  /** Overrides the pathname-derived current destination (demo routes only). */
  currentKey?: DestinationKey | null;
  /** Overrides the pathname-derived Back target (demo routes only): a destination's landing, or an exact target. */
  backTo?: DestinationKey | BackTarget | null;
  /** Extra banner rows above the page, rendered after the shell's own rows (SubNav, payment, offline). */
  banner?: React.ReactNode;
  /** Demo routes: the flags that switch destinations on (live pages read the viewer's flags). */
  navFlags?: NavFlags;
};

/**
 * The signed-in app shell (SPEC 8.2; V3Nav). Sidebar or rail, phone top bar and
 * tab bar, SubNav, banners, ⌘K palette, shortcuts and chords. The shell mode is
 * CSS-only; this component renders every slot and ViewportStage shows the right ones.
 */
export function AppShellView({
  user,
  children,
  hideTabBar = false,
  demo = false,
  currentKey,
  backTo,
  banner,
  navFlags: navFlagsOverride,
}: AppShellViewProps): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpenState] = useState(false);
  // Mounted from the first open on, so closing keeps the dialog's exit transition.
  const [shortcutsMounted, setShortcutsMounted] = useState(false);
  const setShortcutsOpen = (open: boolean) => {
    if (open) setShortcutsMounted(true);
    setShortcutsOpenState(open);
  };

  useEffect(() => markShellMounted(), []);

  const reviewV3 = useFlag("review-v3");
  // P5: Home and Train (with its sections) are flag-gated destinations too.
  const home = useFlag("home");
  const train = useFlag("train");
  const navFlags: NavFlags = navFlagsOverride ?? { "review-v3": reviewV3, home, train };
  const me = { referenceId: user.referenceId };
  const current = currentKey !== undefined ? currentFromKey(currentKey, navFlags) : currentDestinations(pathname, me, navFlags);
  const backOverride = useBackOverride();
  const back =
    backTo !== undefined
      ? backTo === null
        ? null
        : typeof backTo === "string"
          ? backFor(backTo, me)
          : backTo
      : (backOverride ?? backTarget(pathname, me));
  const subnav = subnavFor(current);

  useShellKeys({
    paletteOpen,
    shortcutsOpen,
    setPaletteOpen,
    setShortcutsOpen,
    navigate: (href) => router.push(href),
    demo,
    reviewV3: navFlags["review-v3"] === true,
    navFlags,
  });

  const track = (surface: "sidebar" | "tabbar" | "subnav" | "back" | null) => (dest: DestinationKey) =>
    trackShell({ name: "shell_nav_click", dest, surface: surface ?? navSurface() }, { demo });

  return (
    <>
      <ViewportStage
        data-testid="app-shell"
        nav={
          <Sidebar
            user={user}
            current={current}
            navFlags={navFlags}
            demo={demo}
            onSearch={() => {
              setPaletteOpen(true);
              trackShell({ name: "shell_palette_opened", via: "button" }, { demo });
            }}
            onNavigate={track(null)}
          />
        }
        topbar={<TopBar user={user} back={back} demo={demo} onBack={() => back && track("back")(back.key)} />}
        tabbar={hideTabBar || hidesTabBar(pathname) ? undefined : <TabBar me={me} current={current} navFlags={navFlags} demo={demo} onNavigate={track("tabbar")} />}
        banner={
          <>
            <SubNav
              nav={subnav}
              current={current}
              me={me}
              hideInTabbar={Boolean(back)}
              demo={demo}
              onNavigate={track("subnav")}
            />
            <ShellBanners user={user} demo={demo} />
            <OnlineChip placement="inline" />
            {banner}
          </>
        }
      >
        {children}
      </ViewportStage>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        user={user}
        demo={demo}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      {shortcutsMounted ? <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} demo={demo} flags={navFlagsOverride} /> : null}
      <OnlineChip placement="floating" />
      {demo ? null : <RouteHairline />}
    </>
  );
}
