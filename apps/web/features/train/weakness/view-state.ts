// Client view state of /train/weakness (phase-06 plan §4.2, §5.3): what the member opened, never server data, so it
// lives in a reducer and not in the query cache. The selected pattern (the drill config) is NOT here: the URL holds it
// (`/train/weakness/{slug}`, written with history.pushState), and the screen reads it from usePathname().
//
//   openIndex      the open accordion row (one at a time; -1 = none; default 0, the board's `open`)
//   showAll        rows 4–5 shown ("See all" / "Show fewer")
//   tab            the breakdown tab (`?tab=`, written with replaceState)
//   sawComputing   this mount watched the computing state, so a refetch that turns `ready` shows the ready flash
//   flash          the ready flash is on screen (§4.5 `ready_flash`)
//   pushed         the drill config was opened by a pushState of ours (Esc goes back instead of replacing)
import type { WeaknessStatus } from "@repo/contracts/http/weakness";
import type { WeaknessTab } from "@/components/train/weakness/copy";

export type WeaknessViewState = {
  openIndex: number;
  showAll: boolean;
  tab: WeaknessTab;
  sawComputing: boolean;
  flash: boolean;
  pushed: boolean;
};

export type WeaknessViewAction =
  | { type: "toggleRow"; index: number }
  | { type: "toggleShowAll" }
  | { type: "setTab"; tab: WeaknessTab }
  | { type: "status"; status: WeaknessStatusName }
  | { type: "dismissFlash" }
  | { type: "pushed"; pushed: boolean };

/** The payload's status (CT `WeaknessStatus`). */
export type WeaknessStatusName = WeaknessStatus;

export function initialViewState(tab: WeaknessTab, status: WeaknessStatusName): WeaknessViewState {
  return { openIndex: 0, showAll: false, tab, sawComputing: status === "computing", flash: false, pushed: false };
}

export function viewReducer(s: WeaknessViewState, a: WeaknessViewAction): WeaknessViewState {
  switch (a.type) {
    case "toggleRow":
      return { ...s, openIndex: s.openIndex === a.index ? -1 : a.index };
    case "toggleShowAll": {
      // Hiding rows 4–5 closes one of them if it was open (the open row must stay visible).
      const showAll = !s.showAll;
      return { ...s, showAll, openIndex: !showAll && s.openIndex >= 3 ? -1 : s.openIndex };
    }
    case "setTab":
      return s.tab === a.tab ? s : { ...s, tab: a.tab };
    case "status":
      if (a.status === "computing") return s.sawComputing && !s.flash ? s : { ...s, sawComputing: true, flash: false };
      if (a.status === "ready") return s.sawComputing ? { ...s, sawComputing: false, flash: true } : s;
      // insufficient or failed: a flash still on screen would say "ready" over it (regression: weakness-flash-over-failed).
      return s.sawComputing || s.flash ? { ...s, sawComputing: false, flash: false } : s;
    case "dismissFlash":
      return s.flash ? { ...s, flash: false } : s;
    case "pushed":
      return s.pushed === a.pushed ? s : { ...s, pushed: a.pushed };
  }
}
