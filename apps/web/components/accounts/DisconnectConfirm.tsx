"use client";

// The inline disconnect confirm (phase-04 plan §4.10; DR/V4SettingsConnected `confirmOn`): a group, not a dialog, so
// the card keeps its place. Focus moves to "Keep it" when it opens; Esc inside it is "Keep it" (the opener gets the
// focus back). "Also delete the N imported games and their reviews" is off by default.
import { useEffect, useRef, useState } from "react";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/checkbox";
import { DISCONNECT_BODY, deleteGamesLabel, disconnectQuestion, providerName } from "./copy";

export function DisconnectConfirm({
  provider,
  importedCount,
  pending,
  error,
  onKeep,
  onConfirm,
}: {
  provider: ProviderSlug;
  importedCount: number;
  pending: boolean;
  /** Shown under the buttons when the DELETE failed. */
  error: string | null;
  onKeep: () => void;
  onConfirm: (deleteGames: boolean) => void;
}) {
  const [deleteGames, setDeleteGames] = useState(false);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label={`Disconnect ${providerName(provider)}`}
      data-testid={`account-disconnect-${provider}`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onKeep();
      }}
      className="flex animate-rc-fade flex-col gap-2.5 border border-cb-border bg-cb-bg p-3 motion-reduce:animate-none"
    >
      <span className="font-medium text-cb-text">{disconnectQuestion(provider)}</span>
      <span className="text-sm text-cb-text-soft">{DISCONNECT_BODY}</span>
      {importedCount > 0 ? (
        <CheckboxRow
          label={deleteGamesLabel(importedCount)}
          checked={deleteGames}
          onCheckedChange={setDeleteGames}
          disabled={pending}
          data-testid={`account-disconnect-delete-${provider}`}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button ref={keepRef} variant="secondary" onClick={onKeep} data-testid={`account-disconnect-keep-${provider}`}>
          Keep it
        </Button>
        <Button
          variant="danger"
          loading={pending}
          loadingLabel="Disconnecting…"
          onClick={() => onConfirm(deleteGames)}
          data-testid={`account-disconnect-confirm-${provider}`}
        >
          Disconnect
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-ui text-cb-bad" data-testid={`account-disconnect-error-${provider}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
