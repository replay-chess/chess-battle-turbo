"use client";

// The swappable block at the top of the panel (desktop, iPad L) or under the board (phones, iPad P): plan 4.3
// "Zone" column. One component per zone; PanelZone picks by `view.zone` (precedence is game-core's).

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { FIRST_MOVE_MS, GRACE_MS, STUDY_SECONDS_NON_INITIAL } from "@repo/game-core/constants";
import { isInitialFen } from "@repo/game-core/rules/chess";
import { useCancelLegacyChallenge } from "@/lib/api/mutations/games";
import { useCountdown } from "../../clock/useCountdown";
import { alreadyEndedLine, BUTTONS, copyCtx, ZONE } from "../../copy";
import { reloadVisible } from "../../live/outbox";
import { useController, useGame, useView } from "../GameContext";
import { Ring } from "../Ring";
import { IconReload } from "../icons";

const noopSubscribe = () => () => {};

export function LoadingZone() {
  return (
    <div className="g-zone" aria-busy="true" data-testid="zone-loading">
      <span className="g-lbl">{ZONE.loading}</span>
      <span className="g-sk" style={{ height: 12, width: "70%" }} />
      <span className="g-sk" style={{ height: 12, width: "45%" }} />
    </div>
  );
}

export function WaitingZone() {
  const ref = useGame((g) => g.state.ref);
  const startFen = useGame((g) => g.state.startFen);
  const [copied, setCopied] = useState(false);
  const cancelChallenge = useCancelLegacyChallenge();
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  const link = `${origin}/join/${ref}`;
  const shown = link.replace(/^https?:\/\//, "");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the field is selectable */
    }
  };
  // Legacy POST /api/chess/cancel-game until P9 (plan 5.4); the mutation goes to /play when it settles.
  const cancel = () => cancelChallenge.mutate(ref);
  return (
    <div className="g-zone" data-testid="zone-waiting">
      <span className="g-lbl">
        <span className="g-dotp" aria-hidden="true" />
        {ZONE.waitingLabel}
      </span>
      <p className="g-body">{ZONE.waitingBody(!isInitialFen(startFen))}</p>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="g-inp" readOnly value={shown} aria-label={ZONE.challengeLink} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="g-act" onClick={copy} data-testid="copy-challenge-link">
          {copied ? BUTTONS.copied : BUTTONS.copy}
        </button>
      </div>
      <button type="button" className="g-btn-t" onClick={cancel} disabled={cancelChallenge.isPending} data-testid="cancel-challenge">
        {BUTTONS.cancelChallenge}
      </button>
    </div>
  );
}

export function StudyZone() {
  const controller = useController();
  const view = useView();
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  const study = state.study;
  const cd = useCountdown(study?.endsAt ?? null, controller.serverNow, STUDY_SECONDS_NON_INITIAL * 1000, state.serverNow);
  const last5 = view.modifiers.has("study_last5") || cd.ms <= 5_000;
  const meReady = ctx.spectator ? false : (study?.ready[ctx.me] ?? false);
  const card = state.position;
  return (
    <div className="g-zone" data-variant="soft" data-testid="zone-study">
      <div className="g-zone__row">
        <Ring size={52} progress={cd.progress} />
        <div className="g-zone__col">
          <span className="g-lbl">{state.rematchOf ? ZONE.rematchStudyLabel(ctx) : ZONE.studyLabel}</span>
          <span
            className={`g-mono${last5 ? " g-big5" : ""}`}
            role="timer"
            aria-live="off"
            style={{ fontSize: "1.75rem", fontWeight: 500, lineHeight: 1.1 }}
            data-testid="study-countdown"
          >
            {cd.text}
          </span>
        </div>
      </div>
      {card ? (
        <div className="g-short-hide" style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 8, borderTop: "1px solid var(--cb-border)" }}>
          <span style={{ fontWeight: 500 }}>{card.name}</span>
          <span className="g-body">
            {[card.event, card.year, card.afterLabel].filter((x) => x !== null && x !== "").join(" · ")}
          </span>
        </div>
      ) : null}
      <p className="g-body g-tall">{ZONE.studyBody}</p>
      {ctx.spectator ? null : (
        <button
          type="button"
          className="g-btn-t"
          onClick={() => controller.ready()}
          disabled={meReady}
          data-testid="study-ready"
        >
          {meReady ? ZONE.waitingForOpp(ctx) : BUTTONS.ready}
        </button>
      )}
    </div>
  );
}

export function AbortZone() {
  const controller = useController();
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  const fm = state.firstMove;
  const mine = !ctx.spectator && fm?.side === ctx.me;
  const cd = useCountdown(fm?.deadlineAt ?? null, controller.serverNow, FIRST_MOVE_MS, state.serverNow);
  return (
    <div className="g-zone" data-variant="row" style={{ justifyContent: "flex-start" }} data-testid="zone-abort">
      <Ring size={40} progress={cd.progress} />
      <div className="g-zone__col">
        <span className="g-lbl">{mine ? ZONE.firstMoveMine : ZONE.firstMoveTheirs(ctx)}</span>
        <span className="g-mono" style={{ fontSize: "1.125rem", fontWeight: 500 }} role="timer" aria-live="off">
          {cd.text}
        </span>
        {mine ? (
          <span className="g-tall g-soft" style={{ fontSize: "0.75rem" }}>
            {ZONE.abortNote}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function CoachZone() {
  const hint = useGame((g) => g.bot?.hint ?? null);
  const engineError = useGame((g) => g.bot?.engineError ?? false);
  const otherTab = useGame((g) => g.bot?.otherTab ?? false);
  const controller = useController();
  if (engineError) {
    return (
      <div className="g-zone" role="alert" data-variant="soft" data-testid="zone-engine-error">
        <span className="g-body" style={{ color: "var(--cb-text)" }}>{ZONE.engineError}</span>
        <button type="button" className="g-act" style={{ alignSelf: "flex-start" }} onClick={() => controller.sync()}>
          {BUTTONS.tryAgain}
        </button>
      </div>
    );
  }
  if (otherTab) {
    return (
      <div className="g-zone" role="status" data-variant="soft" data-testid="zone-other-tab">
        <span style={{ fontWeight: 500 }}>{ZONE.otherTab}</span>
        <button type="button" className="g-act" style={{ alignSelf: "flex-start" }} onClick={() => controller.sync()}>
          {BUTTONS.useThisTab}
        </button>
      </div>
    );
  }
  if (!hint) return null;
  return (
    <div className="g-zone" data-testid="zone-coach">
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span className="g-mono" aria-hidden="true" style={{ width: 24, height: 24, flex: "none", border: "1px solid var(--cb-border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem" }}>
          H
        </span>
        <span>{hint.text}</span>
      </div>
    </div>
  );
}

export function ViewingZone({ label }: { label: string }) {
  const dispatch = useController().store.dispatch;
  const flash = useGame((g) => g.flashBackToLive);
  return (
    <div className="g-zone" data-variant="dark" role="status" data-testid="zone-viewing">
      <span className="g-mono" style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {ZONE.viewing(label)}
      </span>
      <button type="button" className="g-viewbtn" data-flash={flash ? "" : undefined} onClick={() => dispatch({ type: "view", ply: null })}>
        {BUTTONS.backToLive}
      </button>
    </div>
  );
}

export function ReconnectZone() {
  const controller = useController();
  const g = useGame((x) => x);
  const restarting = g.restarting !== null;
  const endsAt = g.disconnectedAt !== null ? g.disconnectedAt + GRACE_MS : null;
  const cd = useCountdown(restarting ? null : endsAt, Date.now, GRACE_MS);
  const me = g.state.you.color;
  const myClock = g.state.phase === "playing" && !!me && g.state.clocks.run === me;
  if (restarting) {
    return (
      <div className="g-zone" data-variant="soft" role="status" data-testid="zone-reconnect">
        <span className="g-lbl" style={{ color: "var(--cb-warn)" }}>
          <span className="g-dotp" aria-hidden="true" />
          {ZONE.restartLabel}
        </span>
        <span className="g-body">{ZONE.restartBody}</span>
      </div>
    );
  }
  const body = ZONE.reconnectBody(g.outbox?.san ?? null, myClock);
  return (
    <div className="g-zone" data-variant="soft" role="status" data-testid="zone-reconnect">
      <div className="g-zone__row" style={{ gap: 10 }}>
        <Ring size={36} progress={cd.progress} tone="warn" />
        <div className="g-zone__col">
          <span className="g-lbl" style={{ color: "var(--cb-warn)" }}>
            <span className="g-dotp" aria-hidden="true" />
            {ZONE.reconnecting}
          </span>
          <span className="g-mono" style={{ fontSize: "0.8125rem", textTransform: "uppercase" }}>
            {ZONE.reconnectWithin(cd.text)}
          </span>
        </div>
      </div>
      {body ? <p className="g-body">{body}</p> : null}
      {reloadVisible(g, Date.now()) ? (
        <button type="button" className="g-btn-t" onClick={() => controller.sync()} data-testid="reload-game">
          {BUTTONS.reloadGame}
        </button>
      ) : null}
    </div>
  );
}

export function DisconnectedZone() {
  const controller = useController();
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  const opp = state.players[ctx.me === "w" ? "b" : "w"];
  const cd = useCountdown(opp.graceEndsAt, controller.serverNow, GRACE_MS, state.serverNow);
  const oppToMove = state.turn !== ctx.me;
  return (
    <div className="g-zone" data-variant="soft" role="status" data-testid="zone-disc">
      <div className="g-zone__row" style={{ gap: 10 }}>
        <Ring size={36} progress={cd.progress} tone="warn" />
        <div className="g-zone__col">
          <span className="g-lbl" style={{ color: "var(--cb-warn)" }}>
            {ZONE.discLabel}
          </span>
          <span className="g-mono" style={{ fontSize: "0.8125rem" }}>
            {ZONE.discLine(ctx, cd.text)}
          </span>
        </div>
      </div>
      <p className="g-body g-tall">{ZONE.discBody(oppToMove)}</p>
    </div>
  );
}

export function ServerErrorZone() {
  const controller = useController();
  return (
    <div className="g-zone" data-variant="soft" role="alert" data-testid="zone-error">
      <span className="g-lbl" style={{ color: "var(--cb-bad)" }}>
        {ZONE.errorLabel}
      </span>
      <span style={{ fontWeight: 500 }}>{ZONE.errorTitle}</span>
      <span className="g-body">{ZONE.errorBody}</span>
      <button type="button" className="g-act" style={{ alignSelf: "flex-start" }} onClick={() => controller.sync()} data-testid="reload-game">
        <IconReload />
        {BUTTONS.reloadGame}
      </button>
    </div>
  );
}

export function EndedZone() {
  const view = useView();
  const state = useGame((g) => g.state);
  const ctx = copyCtx(state);
  const player = !ctx.spectator;
  return (
    <div className="g-zone" data-testid="zone-ended">
      <span style={{ fontWeight: 500 }}>{ZONE.endedTitle}</span>
      <span className="g-body">{alreadyEndedLine(view.result, ctx)}</span>
      <div style={{ display: "flex", gap: 6 }}>
        {player && state.result?.method !== "aborted" ? (
          <Link className="g-btn-p" href={`/analysis/${state.ref}`} style={{ flex: "1 1 auto" }}>
            {BUTTONS.analyse}
          </Link>
        ) : null}
        <Link className="g-act" href="/play">
          {BUTTONS.backToPlay}
        </Link>
      </div>
    </div>
  );
}

export function SpectatingZone() {
  const count = useGame((g) => g.state.spectators);
  return (
    <div className="g-zone" data-variant="row" data-testid="zone-spect">
      <span className="g-lbl" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {ZONE.watching(Math.max(1, count))}
      </span>
      <span className="g-soft" style={{ fontSize: "0.75rem" }}>
        {ZONE.spectBody}
      </span>
    </div>
  );
}
