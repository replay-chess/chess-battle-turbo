"use client";

// The result card (plan 4.3 "Result card fields", 2.4): kind label, title, method line, then the named slots in
// their fixed order (rating P9, tournament P12, accuracy P3, bank P5, coach P3/P7, legend P3), the CTA row and
// Share (Copy link, Download PGN; no image until P3's shares). It replaces the top of the panel (desktop) or renders
// in the zone under the board (phones); it never covers the board. Later phases add a slot, never edit the card.

import { useState } from "react";
import Link from "next/link";
import { trackGame } from "@/lib/analytics/game-events";
import { gamePgnHref } from "@/lib/api/queries/games";
import { BUTTONS, copyCtx, resultCopy } from "../copy";
import { useController, useGame, useView } from "./GameContext";
import { IconArrow, IconDownload, IconLink, IconReload, IconShare } from "./icons";
import { LiveGamesSheet } from "./LiveGamesSheet";

export type ResultSlot = "rating" | "tournament" | "accuracy" | "bank" | "coach" | "legend";
export type ResultSlots = Partial<Record<ResultSlot, React.ReactNode>>;
const SLOT_ORDER: readonly ResultSlot[] = ["rating", "tournament", "accuracy", "bank", "coach", "legend"];

export function GameOverCard({ slots = {}, inSheet = false }: { slots?: ResultSlots; inSheet?: boolean }) {
  const headingId = inSheet ? "g-result-h-sheet" : "g-result-h";
  const controller = useController();
  const view = useView();
  const state = useGame((g) => g.state);
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const r = view.result;
  if (!r) return null;

  const ctx = copyCtx(state);
  const text = resultCopy(r, ctx, state);
  const player = !ctx.spectator;
  const aborted = r.method === "aborted";
  const bot = state.mode === "BOT";
  const tournament = state.mode === "TOURNAMENT";
  const oppOnline = state.players[ctx.me === "w" ? "b" : "w"].online;
  const canRematch = player && !aborted && !bot && (state.mode === "FRIEND" || state.mode === "ONLINE") && !state.rematch;
  const newHref = `/play?again=${state.ref}`;

  const copyLink = async () => {
    trackGame("share_game", { method: "link" });
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/game/${state.ref}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="g-zone" style={{ gap: 12 }} data-testid={inSheet ? "zone-result-sheet" : "zone-result"}>
      <div className="g-result" data-kind={r.kind} role="region" aria-labelledby={headingId} data-testid={inSheet ? "game-result-sheet" : "game-result"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="g-lbl">{text.kindLabel}</span>
          <h2 id={headingId} className="g-serif" data-testid="game-result-title">
            {text.title}
          </h2>
          <span style={{ fontSize: "0.9375rem" }} className="g-soft" data-testid="game-result-method">
            {text.method}
          </span>
        </div>
        {SLOT_ORDER.map((k) => (slots[k] ? <div key={k} data-slot={k}>{slots[k]}</div> : null))}
        <div className="g-cta">
          {player && !aborted ? (
            <Link className="g-btn-p" href={`/analysis/${state.ref}`} style={{ minHeight: 48 }} prefetch={false} onClick={() => trackGame("game_over_cta", { cta: "analyse" })} data-testid="analyse-game">
              {BUTTONS.analyse}
              <IconArrow />
            </Link>
          ) : null}
          <div className="g-cta__row">
            {aborted && !tournament ? (
              <Link className="g-btn-p" href={newHref} onClick={() => trackGame("game_over_cta", { cta: "new_game" })}>
                {BUTTONS.newGame}
              </Link>
            ) : null}
            {ctx.spectator ? (
              <button type="button" className="g-btn-p" onClick={() => {
                  trackGame("game_over_cta", { cta: "watch_another" });
                  setWatchOpen(true);
                }}
                data-testid="watch-another"
              >
                {BUTTONS.watchAnother}
              </button>
            ) : null}
            {canRematch ? (
              <button
                type="button"
                className="g-act"
                onClick={() => {
                  trackGame("game_over_cta", { cta: "rematch" });
                  controller.offerRematch();
                }}
                disabled={!oppOnline}
                data-testid="rematch-button"
              >
                <IconReload size={14} />
                {BUTTONS.rematch}
              </button>
            ) : null}
            {bot && player ? (
              <>
                <button type="button" className="g-act" onClick={() => {
                    trackGame("game_over_cta", { cta: "rematch" });
                    controller.offerRematch();
                  }}
                  data-testid="bot-rematch"
                >
                  {BUTTONS.rematchBot(ctx.me === "w" ? "b" : "w")}
                </button>
                {controller.restart ? (
                  <button type="button" className="g-act" onClick={() => {
                      trackGame("game_over_cta", { cta: "restart" });
                      controller.restart?.();
                    }}
                    data-testid="bot-restart"
                  >
                    {BUTTONS.restart}
                  </button>
                ) : null}
              </>
            ) : null}
            {tournament ? (
              <Link className="g-act" href="/tournaments" onClick={() => trackGame("game_over_cta", { cta: "back_to_tournament" })}>
                {BUTTONS.backToTournament}
              </Link>
            ) : !aborted ? (
              <Link className="g-act" href={newHref} onClick={() => trackGame("game_over_cta", { cta: "new_game" })} data-testid="new-game">
                {BUTTONS.newGame}
              </Link>
            ) : null}
            <button
              type="button"
              className="g-act g-sq44"
              onClick={() => setShare((v) => !v)}
              aria-expanded={share}
              aria-label={BUTTONS.share}
              data-testid="share-button"
            >
              <IconShare />
            </button>
          </div>
          {share ? (
            <div role="group" aria-label="Share" className="g-share">
              <button type="button" className="g-act" onClick={copyLink}>
                <IconLink size={14} />
                {copied ? BUTTONS.linkCopied : BUTTONS.copyLink}
              </button>
              {player && !aborted ? (
                <a
                  className="g-act"
                  href={gamePgnHref(state.ref)}
                  download
                  onClick={() => trackGame("share_game", { method: "pgn" })}
                  data-testid="download-pgn"
                >
                  <IconDownload size={14} />
                  {BUTTONS.downloadPgn}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {ctx.spectator ? <LiveGamesSheet open={watchOpen} onOpenChange={setWatchOpen} /> : null}
    </div>
  );
}
