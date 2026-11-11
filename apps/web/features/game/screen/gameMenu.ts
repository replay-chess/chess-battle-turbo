// What the in-game ⋯ menu holds for an actions variant (plan 4.3 "Actions"), and the button's accessible name, which
// lists exactly those items: the fixed "More: Resign, Flip Board, Sound" told spectators about a Resign item their
// menu does not have (D9).
import type { ActionsVariant } from "@repo/game-core/client/viewState";
import { BUTTONS } from "../copy";

export interface GameMenuItems {
  resign: boolean;
  abort: boolean;
  /** Bot games only: Offer Draw moves into the menu once two plies are played. */
  botDraw: boolean;
  label: string;
}

export function gameMenuItems(actions: ActionsVariant, plies: number): GameMenuItems {
  const resign = actions === "online" || actions === "bot";
  // Bot games (no first-move window): Abort while fewer than two plies are played, then Offer Draw (D).
  const abort = actions === "abort" || (actions === "bot" && plies < 2);
  const botDraw = actions === "bot" && plies >= 2;
  const label = BUTTONS.moreActions([
    ...(resign ? [BUTTONS.resign] : []),
    ...(abort ? [BUTTONS.abortItem] : []),
    ...(botDraw ? [BUTTONS.offerDraw] : []),
    BUTTONS.flip,
    BUTTONS.soundItem,
  ]);
  return { resign, abort, botDraw, label };
}
