"use client";

// Game controls (plan 4.3 "Actions", 4.4): the action row at the bottom of the panel (desktop, iPad L) and the
// control bar in BoardStage's footer (phones, iPad P), the ⋯ menu (Resign… / Abort game, Flip board, Sound; Board
// settings stays hidden until P10, handoff H-05) and the resign confirmation: a Popover anchored to ⋯ on desktop,
// a bottom Sheet on phones, with focus on Keep Playing.

import { useState } from "react";
import { absPly } from "@repo/game-core/client/reducer";
import type { ActionsVariant } from "@repo/game-core/client/viewState";
import { trackGame } from "@/lib/analytics/game-events";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { BUTTONS, copyCtx, RESIGN_TITLE, resignBody } from "../copy";
import { useController, useDispatch, useGame, usePrefs, useView } from "./GameContext";
import type { ResultSlots } from "./GameOverCard";
import { GameOverCard } from "./GameOverCardLazy";
import { gameMenuItems } from "./gameMenu";
import {
  IconDraw,
  IconFlag,
  IconFlip,
  IconHint,
  IconLock,
  IconMore,
  IconNext,
  IconPrev,
  IconSound,
  IconUndo,
  IconX,
} from "./icons";

/** Same switch as BoardStage's stack mode, approximated on the viewport for the one choice CSS cannot make. */
export const STACK_QUERY = "(orientation: portrait), (max-width: 650px)";

function useHandlers() {
  const controller = useController();
  const dispatch = useDispatch();
  const prefs = usePrefs();
  const state = useGame((g) => g.state);
  const viewPly = useGame((g) => g.view);
  const live = absPly(state);
  const current = viewPly ?? live;
  const step = (to: number) => dispatch({ type: "view", ply: to >= live ? null : Math.max(state.startPly, to) });
  return {
    canPrev: current > state.startPly,
    canNext: viewPly !== null,
    prev: () => step(current - 1),
    next: () => step(current + 1),
    flip: () => {
      prefs.setFlipped(!prefs.flipped);
      trackGame("flip_board", { on: !prefs.flipped });
    },
    sound: () => {
      prefs.setSound(!prefs.sound);
      trackGame("sound_toggled", { on: !prefs.sound });
    },
    soundOn: prefs.sound,
    askResign: () => dispatch({ type: "resign", open: true }),
    abort: () => controller.abort(),
    draw: () => controller.offerDraw(),
    hint: () => controller.hint?.(),
    undo: () => controller.undo?.(),
  };
}

function GameMenu({ actions, variant }: { actions: ActionsVariant; variant: "row" | "bar" }) {
  const h = useHandlers();
  const plies = useGame((g) => absPly(g.state) - g.state.startPly);
  const { resign: canResign, abort: canAbort, botDraw: canBotDraw, label } = gameMenuItems(actions, plies);
  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        {variant === "row" ? (
          <button type="button" className="g-act g-sq44" aria-label={label} data-testid="game-menu-button">
            <IconMore size={18} />
          </button>
        ) : (
          <button type="button" className="g-foot__btn" aria-label={label} data-testid="game-menu-button-bar">
            <IconMore size={18} />
            {BUTTONS.more}
          </button>
        )}
      </MenuTrigger>
      <MenuContent minWidth={210} side="top" aria-label="Game options">
        {canResign ? (
          <MenuItem icon={<IconFlag />} tone="danger" onSelect={h.askResign} data-testid="resign-button">
            {BUTTONS.resignItem}
          </MenuItem>
        ) : null}
        {canAbort ? (
          <MenuItem icon={<IconX />} tone="danger" onSelect={h.abort} data-testid="abort-menu-item">
            {BUTTONS.abortItem}
          </MenuItem>
        ) : null}
        {canBotDraw ? (
          <MenuItem icon={<IconDraw />} onSelect={h.draw} shortcut="D" data-testid="offer-draw-menu-item">
            {BUTTONS.offerDraw}
          </MenuItem>
        ) : null}
        <MenuItem icon={<IconFlip />} onSelect={h.flip} shortcut="F">
          {BUTTONS.flip}
        </MenuItem>
        <MenuItem icon={<IconSound />} onSelect={h.sound} shortcut="M">
          {BUTTONS.sound(h.soundOn)}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ResignConfirmBody() {
  const controller = useController();
  const dispatch = useDispatch();
  const ctx = copyCtx(useGame((g) => g.state));
  return (
    <div className="g-pop">
      <span className="g-pop__title" id="g-resign-title">
        {RESIGN_TITLE}
      </span>
      <span className="g-body">{resignBody(ctx).replace(`${RESIGN_TITLE} `, "")}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="g-act"
          style={{ flex: "1 1 0" }}
          autoFocus
          onClick={() => dispatch({ type: "resign", open: false })}
          data-testid="keep-playing-button"
        >
          {BUTTONS.keepPlaying}
        </button>
        <button
          type="button"
          className="g-act"
          data-tone="danger"
          style={{ flex: "1 1 0" }}
          onClick={() => controller.resign()}
          data-testid="confirm-resign-button"
        >
          {BUTTONS.resign}
        </button>
      </div>
    </div>
  );
}

/** The action row inside the panel (side mode). */
export function GameActionRow() {
  const view = useView();
  const h = useHandlers();
  const resignOpen = useGame((g) => g.resignOpen);
  const dispatch = useDispatch();
  const stack = useMediaQuery(STACK_QUERY);
  const a = view.actions;
  if (a === "over" || a === "none") return null;
  return (
    <div className="g-actions" data-g-side="" data-testid="game-actions">
      <button type="button" className="g-act g-sq44" onClick={h.prev} disabled={!h.canPrev} aria-label={BUTTONS.previousMove}>
        <IconPrev />
      </button>
      <button type="button" className="g-act g-sq44" onClick={h.next} disabled={!h.canNext} aria-label={BUTTONS.nextMove}>
        <IconNext />
      </button>
      <PrimaryActions variant="row" />
      <Popover open={resignOpen && !stack} onOpenChange={(open) => dispatch({ type: "resign", open })}>
        {/* A real box (not display:contents, which has none): the popover is placed against it, next to ⋯
            (plan 4.2 rules 1 and 3). regression: FIX-A — it opened at the viewport's top-left over a8/b8. */}
        <PopoverAnchor asChild>
          <span className="g-pop-anchor" style={{ display: "inline-flex", flex: "none" }}>
            <GameMenu actions={a} variant="row" />
          </span>
        </PopoverAnchor>
        <PopoverContent width={260} side="top" aria-labelledby="g-resign-title" data-testid="resign-confirm">
          <ResignConfirmBody />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PrimaryActions({ variant }: { variant: "row" | "bar" }) {
  const view = useView();
  const h = useHandlers();
  const a = view.actions;
  const cls = variant === "row" ? "g-act g-grow" : "g-foot__btn";
  const cls2 = variant === "row" ? "g-act g-grow2" : "g-foot__btn";
  const sfx = variant === "bar" ? "-bar" : "";
  switch (a) {
    case "online":
    case "waiting":
    case "disabled":
      return (
        <button
          type="button"
          className={cls}
          onClick={h.draw}
          disabled={a !== "online" || view.draw.disabled}
          data-testid={`offer-draw-button${sfx}`}
        >
          <IconDraw size={variant === "row" ? 16 : 18} />
          {view.draw.label === "sent" ? BUTTONS.offerSent : BUTTONS.offerDraw}
        </button>
      );
    case "bot":
      return (
        <>
          <button type="button" className={cls2} onClick={h.hint} data-testid={`hint-button${sfx}`}>
            <IconHint size={variant === "row" ? 16 : 18} />
            {BUTTONS.hint}
          </button>
          <button type="button" className={cls2} onClick={h.undo} data-testid={`undo-button${sfx}`}>
            <IconUndo size={variant === "row" ? 16 : 18} />
            {BUTTONS.undo}
          </button>
        </>
      );
    case "abort":
      return (
        <button type="button" className={cls} onClick={h.abort} data-testid={`abort-button${sfx}`}>
          <IconX size={variant === "row" ? 16 : 18} />
          {variant === "row" ? BUTTONS.abort : BUTTONS.abortShort}
        </button>
      );
    case "spect":
      return (
        <button type="button" className={cls} onClick={h.flip} data-testid={`flip-button${sfx}`}>
          <IconFlip size={variant === "row" ? 16 : 18} />
          {variant === "row" ? BUTTONS.flip : BUTTONS.flipShort}
        </button>
      );
    case "study":
      return (
        <button type="button" className={cls} disabled>
          <IconLock size={variant === "row" ? 16 : 18} />
          {BUTTONS.movesLocked}
        </button>
      );
    default:
      return null;
  }
}

/** BoardStage footer: the bottom control bar on phones and iPad portrait (56/64 px + safe area). */
export function GameActionBar({ resultSlots }: { resultSlots?: ResultSlots } = {}) {
  const view = useView();
  const h = useHandlers();
  const stack = useMediaQuery(STACK_QUERY);
  const resignOpen = useGame((g) => g.resignOpen);
  const dispatch = useDispatch();
  const [resultOpen, setResultOpen] = useState(false);
  const a = view.actions;
  if (a === "none") return null;
  return (
    <div className="g-foot" data-g-stack="" data-testid="game-action-bar">
      {a === "online" || a === "spect" || a === "over" ? (
        <>
          <button type="button" className="g-foot__btn" onClick={h.prev} disabled={!h.canPrev} aria-label={BUTTONS.previousMove}>
            <IconPrev size={18} />
            {BUTTONS.back}
          </button>
          {a === "over" ? (
            // The folded layout (a short phone at 150 % zoom: BoardStage leaves no room under the board) shows the
            // result card in a sheet, the plan's ResultSheet (4.4). game.css shows this button only there.
            // regression: REGRESSION-2 (iphone-safari@150 over_checkmate_win: no result and no CTA reachable).
            <Sheet open={resultOpen} onOpenChange={setResultOpen}>
              <button
                type="button"
                className="g-foot__btn g-foot__result"
                onClick={() => setResultOpen(true)}
                data-testid="result-sheet-button"
              >
                {BUTTONS.result}
              </button>
              <SheetContent title={BUTTONS.result} hideTitle data-testid="result-sheet">
                <GameOverCard slots={resultSlots} inSheet />
              </SheetContent>
            </Sheet>
          ) : null}
          <button type="button" className="g-foot__btn" onClick={h.next} disabled={!h.canNext} aria-label={BUTTONS.nextMove}>
            <IconNext size={18} />
            {BUTTONS.next}
          </button>
        </>
      ) : null}
      {a === "over" ? null : <PrimaryActions variant="bar" />}
      {a === "spect" || a === "over" ? null : <GameMenu actions={a} variant="bar" />}
      <Sheet open={resignOpen && stack} onOpenChange={(open) => dispatch({ type: "resign", open })}>
        <SheetContent title={RESIGN_TITLE} hideTitle data-testid="resign-confirm-sheet">
          <ResignConfirmBody />
        </SheetContent>
      </Sheet>
    </div>
  );
}
