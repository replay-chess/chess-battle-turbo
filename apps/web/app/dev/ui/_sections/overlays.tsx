"use client";

// Overlays gallery section (SPEC 7.2). Testids are listed in SPEC 7.2 and used by
// e2e/devices/ui/overlays.spec.ts.
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpDown,
  Flag,
  Handshake,
  Keyboard,
  MoreHorizontal,
  Pencil,
  Settings2,
  ListOrdered,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTrigger,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FilterPopover } from "@/components/ui/filter-popover";
import { IconButton } from "@/components/ui/icon-button";
import { InfoButton } from "@/components/ui/info-button";
import { Kbd, ModKey } from "@/components/ui/kbd";
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { notify } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { markShellMounted } from "@/lib/shell/presence";
import { GallerySection, Specimen } from "../_components/Specimen";

const noopSubscribe = () => () => {};

/** `?placement=page` starts the shell-placement toggle unpressed (SPEC 3.9). */
function usePagePlacementParam() {
  return useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("placement") === "page",
    () => false,
  );
}

const SAN = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"];
const MOVE_ROWS = Array.from({ length: 40 }, (_, i) => ({
  n: i + 1,
  white: SAN[(i * 2) % SAN.length],
  black: SAN[(i * 2 + 1) % SAN.length],
}));

const SHORTCUTS: { keys: React.ReactNode[]; label: string }[] = [
  { keys: [<ModKey key="m" />, "K"], label: "Search" },
  { keys: ["?"], label: "Keyboard Shortcuts" },
  { keys: ["G", "P"], label: "Go to Play" },
  { keys: ["G", "L"], label: "Go to Legends" },
  { keys: ["F"], label: "Flip Board" },
  { keys: ["Alt", "T"], label: "Focus Notifications" },
];

const INPUT =
  "min-h-11 w-full rounded-none border border-cb-border-input bg-cb-surface px-3 text-body text-cb-text placeholder:text-cb-text-muted";

export function OverlaysSection() {
  const pagePlacement = usePagePlacementParam();
  // Hydration marker for the e2e spec: clicks before hydration are lost.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [shellOverride, setShellOverride] = useState<boolean | null>(null);
  const shellPlacement = shellOverride ?? !pagePlacement;
  const [inGame, setInGame] = useState(false);

  // Preview the shell placement of the toaster without mounting a shell.
  useEffect(() => {
    if (!shellPlacement) return;
    return markShellMounted();
  }, [shellPlacement]);

  const [coords, setCoords] = useState(true);
  const [lastMove, setLastMove] = useState(true);
  const [filters, setFilters] = useState<string[]>(["Blitz", "Lost"]);
  const [sound, setSound] = useState(true);
  const [name, setName] = useState("Najdorf Trap");
  const [renameOpen, setRenameOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoQueen, setAutoQueen] = useState(true);
  const [confirmMoves, setConfirmMoves] = useState(false);

  const toggleFilter = (f: string, on: boolean) =>
    setFilters((prev) => (on ? (prev.includes(f) ? prev : [...prev, f]) : prev.filter((x) => x !== f)));

  return (
    <GallerySection id="overlays" title="Overlays">
      {inGame ? <div data-rc-controls hidden /> : null}
      {hydrated ? <span data-testid="ui-overlays-ready" hidden /> : null}

      <Specimen
        title="Toast Placement"
        testId="ui-overlays-placement"
        note="Shell placement: top-right on desktop, bottom-centre above the tab bar on phones. Page placement: top-centre. In Game hides toast actions on phones."
      >
        <Button
          variant="secondary"
          pressed={shellPlacement}
          onClick={() => setShellOverride(!shellPlacement)}
          data-testid="ui-toast-shell-toggle"
        >
          Shell Placement
        </Button>
        <Button variant="secondary" pressed={inGame} onClick={() => setInGame((v) => !v)} data-testid="ui-toast-controls-toggle">
          In Game
        </Button>
      </Specimen>

      <Specimen title="Toasts" testId="ui-overlays-toasts" note="One sentence, object first, no trailing period.">
        <Button variant="secondary" data-testid="ui-toast-success" onClick={() => notify.success("Position saved to your bank")}>
          Success
        </Button>
        <Button variant="secondary" data-testid="ui-toast-info" onClick={() => notify.info("Link copied")}>
          Info
        </Button>
        <Button
          variant="secondary"
          data-testid="ui-toast-error"
          onClick={() =>
            notify.error("Game couldn't be created", { action: { label: "Retry", onClick: () => notify.info("Trying again") } })
          }
        >
          Error
        </Button>
        <Button variant="secondary" data-testid="ui-toast-warning" onClick={() => notify.warning("Connection lost, reconnecting")}>
          Warning
        </Button>
        <Button
          variant="secondary"
          data-testid="ui-toast-achievement"
          onClick={() =>
            notify.achievement("Ten-game streak reached", { action: { label: "See It", onClick: () => notify.info("Streak opened") } })
          }
        >
          Achievement
        </Button>
        <Button
          variant="secondary"
          data-testid="ui-toast-undo"
          onClick={() => notify.undo("Position removed from your bank", { onUndo: () => notify.success("Position restored") })}
        >
          Undo
        </Button>
        <Button variant="secondary" data-testid="ui-toast-legacy" onClick={() => toast.success("Legacy toast styled")}>
          Legacy
        </Button>
      </Specimen>

      <Specimen title="Tooltip" testId="ui-overlays-tooltip" note="Hover or focus. Never essential: touch doesn't open it.">
        <Tooltip content="Flip Board" data-testid="ui-tooltip">
          <IconButton label="Flip Board" icon={<ArrowUpDown />} data-testid="ui-tooltip-trigger" />
        </Tooltip>
      </Specimen>

      <Specimen title="Popover" testId="ui-overlays-popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" iconStart={<Settings2 />} data-testid="ui-popover-trigger">
              Display
            </Button>
          </PopoverTrigger>
          <PopoverContent title="Display" data-testid="ui-popover">
            <div className="flex flex-col">
              <CheckboxRow label="Show Coordinates" checked={coords} onCheckedChange={setCoords} />
              <CheckboxRow label="Highlight Last Move" checked={lastMove} onCheckedChange={setLastMove} />
            </div>
            <div className="flex justify-end">
              <Button
                variant="text"
                onClick={() => {
                  setCoords(false);
                  setLastMove(false);
                }}
              >
                Clear
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </Specimen>

      <Specimen title="Info Button" testId="ui-overlays-info">
        <span className="inline-flex items-center gap-1">
          <span className="font-serif text-heading">Positions</span>
          <InfoButton data-testid="ui-info-button" contentTestId="ui-info-popover" title="Positions">
            Mistakes from your games, ready to replay.
          </InfoButton>
        </span>
      </Specimen>

      <Specimen title="Filter Popover" testId="ui-overlays-filter">
        <FilterPopover
          data-testid="ui-filter-popover"
          contentTestId="ui-filter-content"
          title="Filter Games"
          count={filters.length}
          chips={filters.map((f) => (
            <Button key={f} variant="secondary" size="sm" iconEnd={<X />} aria-label={`Remove ${f}`} onClick={() => toggleFilter(f, false)}>
              {f}
            </Button>
          ))}
          onClearAll={() => setFilters([])}
          showLabel="Show 24 Games"
        >
          <div className="flex flex-col">
            <CheckboxRow label="Blitz" checked={filters.includes("Blitz")} onCheckedChange={(v) => toggleFilter("Blitz", v)} />
            <CheckboxRow label="Rapid" checked={filters.includes("Rapid")} onCheckedChange={(v) => toggleFilter("Rapid", v)} />
            <CheckboxRow label="Lost" checked={filters.includes("Lost")} onCheckedChange={(v) => toggleFilter("Lost", v)} />
          </div>
        </FilterPopover>
      </Specimen>

      <Specimen title="Menu" testId="ui-overlays-menu">
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More Actions" icon={<MoreHorizontal />} data-testid="ui-menu-trigger" />
          </MenuTrigger>
          <MenuContent data-testid="ui-menu">
            <MenuItem icon={<Handshake />}>Offer Draw</MenuItem>
            <MenuItem icon={<ArrowUpDown />} shortcut="F">
              Flip Board
            </MenuItem>
            <MenuCheckboxItem icon={<Volume2 />} checked={sound} onCheckedChange={setSound} data-testid="ui-menu-sound">
              Sound
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuItem icon={<Flag />} tone="danger">
              Resign…
            </MenuItem>
            <MenuItem icon={<X />} disabled>
              Abort
            </MenuItem>
          </MenuContent>
        </Menu>
      </Specimen>

      <Specimen title="Dialog" testId="ui-overlays-dialog">
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" iconStart={<Pencil />} data-testid="ui-dialog-trigger">
              Rename Position
            </Button>
          </DialogTrigger>
          <DialogContent title="Rename Position" data-testid="ui-dialog">
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                setRenameOpen(false);
                notify.success(`${name.trim() || "Position"} renamed`);
              }}
            >
              <DialogBody>
                <label htmlFor="ui-dialog-name" className="text-ui font-medium">
                  Name
                </label>
                <input id="ui-dialog-name" className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" iconStart={<Keyboard />} data-testid="ui-dialog-xl-trigger">
              Keyboard Shortcuts
            </Button>
          </DialogTrigger>
          <DialogContent title="Keyboard Shortcuts" size="xl" data-testid="ui-dialog-xl">
            <DialogBody>
              <dl className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
                {SHORTCUTS.map((s) => (
                  <div key={s.label} className="flex min-h-11 items-center justify-between gap-4 border-b border-cb-border">
                    <dt className="text-body">{s.label}</dt>
                    <dd className="inline-flex gap-1">
                      {s.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </Specimen>

      <Specimen title="Alert Dialog" testId="ui-overlays-alert-dialog" note="Initial focus is on the safe action.">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger-outline" iconStart={<Flag />} data-testid="ui-alert-dialog-trigger">
              Resign
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            title="Resign This Game?"
            description="Your opponent wins and the game ends now."
            data-testid="ui-alert-dialog"
          >
            <AlertDialogCancel>Keep Playing</AlertDialogCancel>
            <AlertDialogAction tone="danger">Resign</AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>
      </Specimen>

      <Specimen title="Sheet" testId="ui-overlays-sheet">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary" iconStart={<ListOrdered />} data-testid="ui-sheet-trigger">
              Moves
            </Button>
          </SheetTrigger>
          <SheetContent title="Moves" height="60" data-testid="ui-sheet">
            <ol className="flex flex-col">
              {MOVE_ROWS.map((r) => (
                <li
                  key={r.n}
                  className="grid min-h-9 grid-cols-[3rem_1fr_1fr] items-center border-b border-cb-border font-mono text-ui tabular-nums"
                >
                  <span className="text-cb-text-soft">{r.n}.</span>
                  <span>{r.white}</span>
                  <span>{r.black}</span>
                </li>
              ))}
            </ol>
          </SheetContent>
        </Sheet>
      </Specimen>

      <Specimen title="Responsive Dialog" testId="ui-overlays-responsive" note="A sheet in tab-bar mode, a dialog otherwise.">
        <ResponsiveDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Game Settings"
          data-testid="ui-responsive-dialog"
          trigger={
            <Button variant="secondary" iconStart={<Settings2 />} data-testid="ui-responsive-dialog-trigger">
              Game Settings
            </Button>
          }
        >
          <CheckboxRow label="Always Promote to Queen" checked={autoQueen} onCheckedChange={setAutoQueen} />
          <CheckboxRow
            label="Confirm Moves"
            description="Tap twice before a move is sent."
            checked={confirmMoves}
            onCheckedChange={setConfirmMoves}
          />
        </ResponsiveDialog>
      </Specimen>
    </GallerySection>
  );
}
