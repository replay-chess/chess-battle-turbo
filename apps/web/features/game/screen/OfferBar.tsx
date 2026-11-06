"use client";

// Offer bars (plan 4.2 rule 2, 4.3 #21/#52/#53): draw received, rematch received (with its countdown), rematch
// sent. They sit above the action row (desktop) or above the control bar (phones), never over the board.
// Decline comes first in the DOM.

import { REMATCH_MS } from "@repo/game-core/constants";
import { useCountdown } from "../clock/useCountdown";
import { BARS, BUTTONS, copyCtx } from "../copy";
import { useController, useGame, useView } from "./GameContext";

export function OfferBar() {
  const view = useView();
  if (view.bar === "draw") return <DrawBar />;
  if (view.bar === "rematch_in") return <RematchIn />;
  if (view.bar === "rematch_out") return <RematchOut />;
  return null;
}

function DrawBar() {
  const controller = useController();
  const ctx = copyCtx(useGame((g) => g.state));
  const t = BARS.drawOffer(ctx);
  return (
    <div className="g-ibar" role="alert" data-testid="draw-offer-bar">
      <span>
        <b style={{ fontWeight: 600 }}>{t.who}</b>
        {t.rest}
      </span>
      <button type="button" className="g-act" onClick={() => controller.answerDraw(false)} data-testid="decline-draw">
        {BUTTONS.decline}
      </button>
      <button type="button" className="g-btn-p" onClick={() => controller.answerDraw(true)} data-testid="accept-draw">
        {BUTTONS.accept}
      </button>
    </div>
  );
}

function RematchIn() {
  const controller = useController();
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  const cd = useCountdown(state.rematch?.expiresAt ?? null, controller.serverNow, REMATCH_MS, state.serverNow);
  const t = BARS.rematchIn(ctx);
  return (
    <div className="g-ibar" role="alert" data-testid="rematch-offer-bar">
      <span>
        <b style={{ fontWeight: 600 }}>{t.who}</b>
        {t.rest}{" "}
        <span className="g-mono g-soft" style={{ fontSize: "0.6875rem" }}>
          · {cd.text}
        </span>
      </span>
      <button type="button" className="g-act" onClick={() => controller.answerRematch(false)} data-testid="decline-rematch">
        {BUTTONS.decline}
      </button>
      <button type="button" className="g-btn-p" onClick={() => controller.answerRematch(true)} data-testid="accept-rematch">
        {BUTTONS.accept}
      </button>
    </div>
  );
}

function RematchOut() {
  const controller = useController();
  const ctx = copyCtx(useGame((g) => g.state));
  return (
    <div className="g-ibar" role="status" data-testid="rematch-sent-bar">
      <span className="g-spin" aria-hidden="true" />
      <span>{BARS.rematchOut(ctx)}</span>
      <button type="button" className="g-act" onClick={() => controller.cancelRematch()} data-testid="cancel-rematch">
        {BUTTONS.cancel}
      </button>
    </div>
  );
}
