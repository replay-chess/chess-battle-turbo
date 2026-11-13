"use client";

// The unlinked Lichess card's body (phase-04 plan §4.10 `li_connecting`, `li_denied`; §7.3.4): "Connect Lichess" is a
// full navigation to OAU-1, which sends the browser to lichess.org and back to `/settings/connected?lichess=…`.
// From the click until the page unloads the button reads "Waiting for Lichess…".
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LICHESS_DENIED, LICHESS_UNLINKED_HINT, lichessErrorCopy } from "./copy";

/** The OAuth return the page consumed from `?lichess=` (null: none). */
export type LichessReturn = { kind: "denied" } | { kind: "error"; reason: string | null } | null;

export function LichessConnect({
  connecting,
  returned,
  onConnect,
}: {
  connecting: boolean;
  returned: LichessReturn;
  onConnect: () => void;
}) {
  const message = returned?.kind === "denied" ? LICHESS_DENIED : returned?.kind === "error" ? lichessErrorCopy(returned.reason) : null;
  return (
    <>
      <p className="m-0 text-sm text-cb-text-soft">{LICHESS_UNLINKED_HINT}</p>
      {message ? (
        <p role="alert" className="m-0 flex items-start gap-1.5 text-ui leading-[1.4] text-cb-bad" data-testid="account-lichess-error">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
      <div>
        <Button
          variant="secondary"
          loading={connecting}
          loadingLabel="Waiting for Lichess…"
          onClick={onConnect}
          data-testid="account-lichess-connect"
        >
          Connect Lichess
        </Button>
      </div>
    </>
  );
}
