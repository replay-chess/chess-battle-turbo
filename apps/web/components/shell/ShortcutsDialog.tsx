"use client";

import { Fragment, useSyncExternalStore } from "react";
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog";
import { Kbd, ModKey } from "@/components/ui/kbd";
import { SwitchRow } from "@/components/ui/switch";
import { trackShell } from "@/lib/analytics/shell-events";
import { useFlag } from "@/lib/flags/client";
import { shortcutRegistryVersion, shortcutSections, subscribeShortcutRegistry } from "@/lib/shell/shortcuts";
import { setSingleKeyEnabled, useSingleKeyShortcuts } from "@/lib/shell/prefs";
import { cn } from "@/lib/utils";

function sizeFor(sections: number): "sm" | "lg" | "xl" {
  if (sections <= 1) return "sm";
  if (sections === 2) return "lg";
  return "xl";
}

function Keys({ keys }: { keys: string[][] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((seq, i) => (
        <Fragment key={seq.join("+")}>
          {i > 0 ? <span className="px-0.5 text-ui text-cb-text-soft">or</span> : null}
          {seq.map((k) => (
            <Kbd key={k}>{k === "Mod" ? <ModKey /> : k}</Kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Keyboard shortcuts (V3Shortcuts), rendered from the SHORTCUT_SECTIONS
 * registry. Phase 1 registers only Everywhere. The footer holds the
 * Single-Key Shortcuts switch (WCAG 2.1.4).
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  demo = false,
  flags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  demo?: boolean;
  /** The shell's flags, when a page fixes them (the /dev/ui demos pass the real route's values); else the viewer's. */
  flags?: { "review-v3"?: boolean; "review-share"?: boolean; home?: boolean; train?: boolean };
}) {
  const singleKey = useSingleKeyShortcuts();
  const viewerReviewV3 = useFlag("review-v3");
  const viewerReviewShare = useFlag("review-share");
  const reviewV3 = flags?.["review-v3"] ?? viewerReviewV3;
  const reviewShare = flags?.["review-share"] ?? viewerReviewShare;
  // P5: G H (Home) and G M (Mistake Bank) rows show while their flags are on.
  const viewerHome = useFlag("home");
  const viewerTrain = useFlag("train");
  const home = flags?.home ?? viewerHome;
  const train = flags?.train ?? viewerTrain;
  // Pages register their own sections while mounted (registerReviewShortcuts); re-render when one comes or goes.
  useSyncExternalStore(subscribeShortcutRegistry, shortcutRegistryVersion, () => 0);
  const sections = shortcutSections({ reviewV3, reviewShare, home, train }).filter((s) => s.rows.length);
  const columns =
    sections.length >= 3 ? "grid-cols-4 narrow:grid-cols-2" : sections.length === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Keyboard Shortcuts"
        titleVariant="serif"
        description={
          <>
            Press <Kbd>?</Kbd> any time
          </>
        }
        size={sizeFor(sections.length)}
        data-testid="shortcuts-dialog"
        data-rc-shell-dialog=""
      >
        <DialogBody>
          <div className={cn("grid gap-7 vh700:gap-4", columns)}>
            {sections.map((section) => (
              <section key={section.title} aria-labelledby={`shortcuts-${section.scope}`}>
                <h3 id={`shortcuts-${section.scope}`} className="text-overline mb-1.5">
                  {section.title}
                </h3>
                <ul>
                  {section.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-cb-border-subtle text-body vh700:min-h-[34px]"
                    >
                      <span>{row.label}</span>
                      <Keys keys={row.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <SwitchRow
              label="Single-Key Shortcuts"
              description="/, ? and G shortcuts. ⌘K always works."
              checked={singleKey}
              onCheckedChange={(enabled) => {
                setSingleKeyEnabled(enabled);
                trackShell({ name: "shell_shortcuts_toggled", enabled }, { demo });
              }}
              data-testid="shortcuts-single-key-switch"
            />
            <p className="text-ui text-cb-text-soft">Single-letter keys are off while you type in a field.</p>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
