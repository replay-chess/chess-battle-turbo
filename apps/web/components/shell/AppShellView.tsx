"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { navSurface, trackShell } from "@/lib/analytics/shell-events";
import { backFor, backTarget, currentDestinations, currentFromKey, hidesTabBar, subnavFor } from "@/lib/nav/destinations";
import { markShellMounted } from "@/lib/shell/presence";
import type { DestinationKey, ShellUser } from "@/lib/shell/types";
import { CommandPalette } from "./CommandPalette";
import { OnlineChip } from "./OnlineChip";
import { RouteHairline } from "./RouteHairline";
import { ShellBanners } from "./ShellBanners";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { SubNav } from "./SubNav";
import { TabBar } from "./TabBar";
import { TopBar } from "./TopBar";
import { useShellKeys } from "./useShellKeys";

export type AppShellViewProps = {
  user: ShellUser;
  children: React.ReactNode;
  /** Game screens: no phone tab bar (the BoardStage footer replaces it). Default false. */
  hideTabBar?: boolean;
  /** /dev routes: Clerk actions disabled, analytics off, hairline off, profile hrefs become hashes. */
  demo?: boolean;
  /** Overrides the pathname-derived current destination (demo routes only). */
  currentKey?: DestinationKey | null;
  /** Overrides the pathname-derived Back target (demo routes only). */
  backTo?: DestinationKey | null;
  /** Extra banner rows above the page, rendered after the shell's own rows (SubNav, payment, offline). */
  banner?: React.ReactNode;
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
}: AppShellViewProps): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => markShellMounted(), []);

  const me = { referenceId: user.referenceId };
  const current = currentKey !== undefined ? currentFromKey(currentKey) : currentDestinations(pathname, me);
  const back = backTo !== undefined ? (backTo ? backFor(backTo, me) : null) : backTarget(pathname, me);
  const subnav = subnavFor(current);

  useShellKeys({
    paletteOpen,
    shortcutsOpen,
    setPaletteOpen,
    setShortcutsOpen,
    navigate: (href) => router.push(href),
    demo,
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
            demo={demo}
            onSearch={() => {
              setPaletteOpen(true);
              trackShell({ name: "shell_palette_opened", via: "button" }, { demo });
            }}
            onNavigate={track(null)}
          />
        }
        topbar={<TopBar user={user} back={back} demo={demo} onBack={() => back && track("back")(back.key)} />}
        tabbar={hideTabBar || hidesTabBar(pathname) ? undefined : <TabBar me={me} current={current} demo={demo} onNavigate={track("tabbar")} />}
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
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} demo={demo} />
      <OnlineChip placement="floating" />
      {demo ? null : <RouteHairline />}
    </>
  );
}
