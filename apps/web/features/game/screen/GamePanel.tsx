"use client";

// The panel (plan 4.2, 4.4): BoardStage's aside. Side mode (desktop, iPad L): header, zone or result card, status
// line, move list, offer bars, in-panel toast, action row; its edges line up with the player bars. Stack mode
// (phones, iPad P): zone, status, move strip, offer bars and toast under the board; the header and the move list
// hide (the list opens in a Sheet), and the controls move to BoardStage's footer.

import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { copyCtx, headerRight, plyLabel, STATUS_ALERT, statusText } from "../copy";
import { GameActionRow } from "./GameActions";
import { useGame, useView } from "./GameContext";
import { GameOverCard, type ResultSlots } from "./GameOverCard";
import { GameToast } from "./GameToast";
import { InGameChips } from "./InGameChips";
import { gameSans, MoveList } from "./MoveList";
import { MoveStrip } from "./MoveStrip";
import { OfferBar } from "./OfferBar";
import {
  AbortZone,
  CoachZone,
  DisconnectedZone,
  EndedZone,
  LoadingZone,
  ReconnectZone,
  ServerErrorZone,
  SpectatingZone,
  StudyZone,
  ViewingZone,
  WaitingZone,
} from "./zones/Zones";

export function GamePanel({ resultSlots }: { resultSlots?: ResultSlots }) {
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  return (
    <div className="g-side" data-testid="game-panel" aria-label="Game panel">
      <div className="g-head" data-g-side="">
        <span className="g-lbl" data-testid="game-header-left">
          {state.header.left}
        </span>
        <span className="g-lbl" data-testid="game-header-right">
          {headerRight(state, ctx.spectator)}
        </span>
      </div>
      <TopBarTitle>
        <span className="g-lbl" data-testid="game-topbar-title">
          {headerRight(state, ctx.spectator)}
        </span>
      </TopBarTitle>
      <InGameChips />
      <PanelZone resultSlots={resultSlots} />
      <StatusLine />
      <div data-g-side="" style={{ display: "contents" }}>
        <MoveList />
      </div>
      <MoveStrip />
      <OfferBar />
      <GameToast />
      <GameActionRow />
    </div>
  );
}

function PanelZone({ resultSlots }: { resultSlots?: ResultSlots }) {
  const view = useView();
  const state = useGame((g) => g.state);
  const viewPly = useGame((g) => g.view);
  switch (view.zone) {
    case "loading":
      return <LoadingZone />;
    case "waiting":
      return <WaitingZone />;
    case "study":
      return <StudyZone />;
    case "coach":
      return <CoachZone />;
    case "viewing":
      return <ViewingZone label={viewPly === null ? "" : plyLabel(state, viewPly, gameSans(state))} />;
    case "reconnect":
      return <ReconnectZone />;
    case "disc":
      return <DisconnectedZone />;
    case "abort":
      return <AbortZone />;
    case "error":
      return <ServerErrorZone />;
    case "ended":
      return <EndedZone />;
    case "spect":
      return <SpectatingZone />;
    case "result":
      return <GameOverCard slots={resultSlots} />;
    default:
      return null;
  }
}

function StatusLine() {
  const view = useView();
  const state = useGame((g) => g.state);
  if (!view.status) return null;
  const text = statusText(view.status, copyCtx(state), state);
  if (!text) return null;
  return (
    <div className="g-status" role="status" data-tone={STATUS_ALERT.has(view.status.code) ? "bad" : undefined} data-testid="game-status">
      {text}
    </div>
  );
}
