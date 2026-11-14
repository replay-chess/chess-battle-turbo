"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { Command } from "cmdk";
import {
  BookOpen,
  Crown,
  CreditCard,
  Keyboard,
  LogOut,
  Moon,
  Play,
  Search,
  ShieldCheck,
  Sun,
  Swords,
  Trophy,
  UserPlus,
  UserRound,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { trackShell } from "@/lib/analytics/shell-events";
import {
  LEGEND_SEARCH_DEBOUNCE_MS,
  LEGEND_SEARCH_MIN,
  PALETTE_GROUPS,
  buildPaletteRows,
  filterRows,
  legendRows,
  legendSearchUrl,
  parseLegendSearch,
  type PaletteRow,
} from "@/lib/shell/palette";
import type { ShellUser } from "@/lib/shell/types";
import { useOnline } from "./OnlineChip";
import { runSignOut } from "./useAccountActions";
import { useDeferredAction } from "./useDeferredAction";

const ICONS: Record<string, LucideIcon> = {
  play: Play,
  tournaments: Trophy,
  legends: Crown,
  openings: BookOpen,
  profile: UserRound,
  membership: CreditCard,
  "find-opponent": Swords,
  challenge: UserPlus,
  shortcuts: Keyboard,
  admin: ShieldCheck,
  signout: LogOut,
};

type LegendResult = { query: string; status: "ok" | "failed"; rows: PaletteRow[] };

const ITEM =
  "flex min-h-12 cursor-pointer items-center gap-3 px-4 py-1 text-body text-cb-text data-[selected=true]:bg-cb-fill forced-colors:data-[selected=true]:outline forced-colors:data-[selected=true]:outline-2 focus-visible:-outline-offset-2";

/**
 * ⌘K palette (V3CommandPalette). Rendered on every device; opened by ⌘K/Ctrl+K,
 * `/` on fine pointers, and the sidebar search button. Filtering is ours
 * (lib/shell/palette.ts), so cmdk only handles the listbox and the keys.
 */
export function CommandPalette({
  open,
  onOpenChange,
  user,
  demo = false,
  onOpenShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ShellUser;
  demo?: boolean;
  onOpenShortcuts: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const clerk = useClerk();
  const { resolvedTheme, setTheme } = useTheme();
  const online = useOnline();
  const { defer, onCloseAutoFocus } = useDeferredAction();
  const [query, setQuery] = useState("");
  const [legends, setLegends] = useState<LegendResult | null>(null);
  // Set when a row navigates: focus moves to #main once the pathname changes.
  const navigatedFrom = useRef<string | null>(null);
  const skipFocusRestore = useRef(false);

  const q = query.trim();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const rows = filterRows(
    buildPaletteRows({ me: { referenceId: user.referenceId }, isAdmin: user.isAdmin, theme, demo }),
    query,
  );

  useEffect(() => {
    if (!open || q.length < LEGEND_SEARCH_MIN) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(legendSearchUrl(q), { signal: controller.signal });
        if (!res.ok) throw new Error(`legend search ${res.status}`);
        const hits = parseLegendSearch(await res.json());
        if (!controller.signal.aborted) setLegends({ query: q, status: "ok", rows: legendRows(hits) });
      } catch {
        if (!controller.signal.aborted) setLegends({ query: q, status: "failed", rows: [] });
      }
    }, LEGEND_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, q]);

  useEffect(() => {
    if (navigatedFrom.current === null || navigatedFrom.current === pathname) return;
    navigatedFrom.current = null;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);

  const searching = q.length >= LEGEND_SEARCH_MIN;
  const legendState: "none" | "loading" | "offline" | "rows" = !searching
    ? "none"
    : !online
      ? "offline"
      : legends?.query !== q
        ? "loading"
        : legends.status === "failed"
          ? "offline"
          : "rows";
  const legendHits = legendState === "rows" ? (legends?.rows ?? []) : [];
  const allRows = [...rows, ...legendHits];
  const empty = allRows.length === 0 && legendState !== "loading" && legendState !== "offline";

  function setOpen(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function select(row: PaletteRow) {
    trackShell(
      {
        name: "shell_palette_command",
        id: row.group === "legends" ? "legend" : row.id,
        group: row.group,
        queryLength: q.length,
      },
      { demo },
    );
    if (row.href) {
      const href = row.href;
      navigatedFrom.current = pathname;
      skipFocusRestore.current = true;
      setOpen(false);
      router.push(href);
      return;
    }
    if (row.action === "shortcuts") {
      trackShell({ name: "shell_shortcuts_opened", via: "palette" }, { demo });
      defer(onOpenShortcuts);
      setOpen(false);
      return;
    }
    if (row.action === "theme") {
      setOpen(false);
      setTheme(theme === "dark" ? "light" : "dark");
      return;
    }
    if (row.action === "signout" && !demo) {
      setOpen(false);
      void runSignOut(clerk, undefined, user.referenceId);
    }
  }

  function handleCloseAutoFocus(event: Event) {
    onCloseAutoFocus(event);
    if (skipFocusRestore.current) {
      skipFocusRestore.current = false;
      event.preventDefault();
    }
  }

  const renderRow = (row: PaletteRow) => {
    const Icon =
      row.group === "legends"
        ? Crown
        : row.id === "theme"
          ? theme === "dark"
            ? Sun
            : Moon
          : (ICONS[row.id] ?? Search);
    return (
      <Command.Item
        key={row.id}
        value={row.id}
        onSelect={() => select(row)}
        data-testid={`palette-item-${row.id}`}
        className={ITEM}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 text-cb-text-soft" />
        <span className="min-w-0 flex-1 truncate">{row.title}</span>
        {row.hint ? <span className="font-mono text-xs text-cb-text-soft">{row.hint}</span> : null}
      </Command.Item>
    );
  };

  const GROUP =
    "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        size="lg"
        align="top"
        hideTitle
        title="Command Palette"
        hideClose
        data-testid="command-palette"
        data-rc-shell-dialog=""
        onCloseAutoFocus={handleCloseAutoFocus}
        className="overflow-hidden"
      >
        <Command shouldFilter={false} loop={false} label="Command Palette" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2.5 border-b border-cb-border px-4">
            <Search aria-hidden="true" size={18} className="shrink-0 text-cb-text-soft" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              data-testid="command-palette-input"
              placeholder="Search pages, legends, actions…"
              className="h-14 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-cb-text placeholder:text-cb-text-soft focus:outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto pb-2">
            {PALETTE_GROUPS.filter((g) => g.id !== "legends").map((g) => {
              const groupRows = rows.filter((r) => r.group === g.id);
              if (!groupRows.length) return null;
              return (
                <Command.Group key={g.id} heading={g.heading} className={GROUP}>
                  {groupRows.map(renderRow)}
                </Command.Group>
              );
            })}
            {legendState === "rows" && legendHits.length ? (
              <Command.Group heading="Legends" className={GROUP}>
                {legendHits.map(renderRow)}
              </Command.Group>
            ) : null}
            {legendState === "loading" ? (
              <div
                data-testid="palette-legends-loading"
                className="flex items-center gap-2.5 px-4 py-3 text-ui text-cb-text-soft"
              >
                <Spinner size="sm" />
                Searching legends…
              </div>
            ) : null}
            {legendState === "offline" ? (
              <div
                data-testid="palette-legends-offline"
                className="flex items-center gap-2.5 px-4 py-3 text-ui text-cb-text-soft"
              >
                <WifiOff aria-hidden="true" size={14} />
                Search needs a connection
              </div>
            ) : null}
            {empty ? (
              <p data-testid="palette-empty" className="px-4 py-5 text-cb-text-soft">
                No pages or actions match.
              </p>
            ) : null}
          </Command.List>
          <div
            aria-hidden="true"
            className="flex gap-4 border-t border-cb-border px-4 py-2 text-xs text-cb-text-soft vh640:hidden"
          >
            ↑ ↓ move · ↵ open · Esc close
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
