"use client";

// The unlinked Chess.com card's body (phase-04 plan §4.10 `none_linked`, `looking`, `not_found`; §7.3.3): the
// username field and "Look up profile". In settings the link POST does the lookup itself, so success goes straight
// to the syncing card. The username is checked with the contract's regex before anything is sent (no zod here).
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { RetryCountdown } from "@/components/system/RetryCountdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { CircleAlert } from "lucide-react";
import { CHESSCOM_UNLINKED_HINT, linkErrorCopy, notFoundCopy, type LinkErrorKind } from "./copy";
import { CHESSCOM_USERNAME_MESSAGE } from "@repo/contracts/http/p04-plain";

export type ChessComFormError = { kind: LinkErrorKind; typed: string } | null;

export function ChessComLinkForm({
  value,
  onChange,
  onSubmit,
  looking,
  error,
  countdown,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  looking: boolean;
  error: ChessComFormError;
  /** The link POST's 429 wait (useRetryCountdown), when one runs. */
  countdown?: RetryCountdownState;
}) {
  const limited = Boolean(countdown?.limited);
  const errorId = "chesscom-link-error";
  const message = error ? errorMessage(error) : null;
  return (
    <>
      <p className="m-0 text-sm text-cb-text-soft">{CHESSCOM_UNLINKED_HINT}</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!looking && !limited) onSubmit();
        }}
        noValidate
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Chess.com username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          invalid={Boolean(error)}
          aria-describedby={[message ? errorId : null, limited ? countdown?.rowId : null].filter(Boolean).join(" ") || undefined}
          className="max-w-[280px] min-w-0 flex-[1_1_200px]"
          data-testid="account-chesscom-input"
        />
        <Button
          type="submit"
          loading={looking}
          loadingLabel="Looking up…"
          aria-disabled={limited || undefined}
          data-testid="account-chesscom-lookup"
        >
          Look up profile
        </Button>
      </form>
      {message ? (
        <p id={errorId} role="alert" className="m-0 flex items-start gap-1.5 text-ui leading-[1.4] text-cb-bad" data-testid="account-chesscom-error">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
      {countdown ? <RetryCountdown countdown={countdown} data-testid="account-chesscom-countdown" /> : null}
    </>
  );
}

function errorMessage(error: NonNullable<ChessComFormError>): string {
  switch (error.kind) {
    case "not_found":
      return notFoundCopy(error.typed);
    case "invalid":
      return CHESSCOM_USERNAME_MESSAGE;
    default:
      return linkErrorCopy(error.kind);
  }
}
