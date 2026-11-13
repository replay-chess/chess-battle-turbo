"use client";

// One provider card on /settings/connected (phase-04 plan §4.10; DR/V4SettingsConnected*.dc.html `section.acc`).
// Presentational: everything it shows comes from `cardModel()` (model.ts) and the handlers; the real page
// (ConnectedScreen) and the /dev/ui/connected demo pass the same props.
//
// Header row: provider tag · username (h2: no panel heading until P10) · status pill. Linked: initials avatar,
// ratings, the sync line, the import progress (`role="status"`), at most one banner, the daily-import switch, Sync
// now and Disconnect (or the inline disconnect confirm). Unlinked: the provider's own body (`unlinked`).
import { useRef } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { SwitchRow } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { AUTO_IMPORT_LABEL, SYNC_START_FAILED, WAITING_FOR_TRIAL, mmss, providerName, rateLimitedCopy } from "./copy";
import { DisconnectConfirm } from "./DisconnectConfirm";
import type { CardBanner, CardModel, LinkedCardModel } from "./model";
import { ProviderAvatar } from "./ProviderAvatar";

export const HELP_IMPORTING_HREF = "/help#importing";

export type AccountCardProps = {
  model: CardModel;
  avatarUrl?: string | null;
  /** The body of an unlinked card (the Chess.com form, the Lichess connect button). */
  unlinked?: React.ReactNode;
  onSync?: () => void;
  /** The last Sync now failed: `paywall` (402) or `failed`. */
  syncError?: "paywall" | "failed" | null;
  onAutoImport?: (on: boolean) => void;
  confirmOpen?: boolean;
  onConfirmOpenChange?: (open: boolean) => void;
  disconnectPending?: boolean;
  disconnectError?: string | null;
  onDisconnect?: (deleteGames: boolean) => void;
};

export function AccountCard(props: AccountCardProps) {
  const { model } = props;
  const headingId = `account-${model.provider}-h`;
  const tagId = `account-${model.provider}-tag`;
  return (
    <section
      // "Chess.com knightowl_88" / "Lichess Not linked": two unlinked cards keep distinct region names.
      aria-labelledby={`${tagId} ${headingId}`}
      data-testid={`account-card-${model.provider}`}
      data-view={model.linked ? model.view : "off"}
      className="flex min-w-0 flex-col gap-3 border border-cb-border bg-cb-surface p-4 tabbar:p-3.5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Tag id={tagId} size="md" className="text-xs">
          {providerName(model.provider)}
        </Tag>
        <h2 id={headingId} className="m-0 min-w-0 flex-[1_1_8rem] truncate text-base leading-snug font-medium text-cb-text">
          {model.title}
        </h2>
        <Tag size="md" tone={model.pill.tone} data-testid={`account-pill-${model.provider}`}>
          {model.pill.label}
        </Tag>
      </div>
      {model.linked ? <LinkedBody {...props} model={model} /> : props.unlinked}
    </section>
  );
}

function LinkedBody({
  model,
  avatarUrl = null,
  onSync,
  syncError = null,
  onAutoImport,
  confirmOpen = false,
  onConfirmOpenChange,
  disconnectPending = false,
  disconnectError = null,
  onDisconnect,
}: AccountCardProps & { model: LinkedCardModel }) {
  const p = model.provider;
  const disconnectRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <div className="flex min-w-0 items-center gap-3.5">
        <ProviderAvatar username={model.title} avatarUrl={avatarUrl} seed={`${p}:${model.title.toLowerCase()}`} />
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-cb-text">
            <span className="max-w-full min-w-0 truncate">{model.title}</span>
            {model.ratings ? (
              <span className="min-w-0 font-mono text-xs break-words text-cb-text-soft" data-testid={`account-ratings-${p}`}>
                {model.ratings}
              </span>
            ) : null}
          </span>
          <span className="text-sm text-cb-text-soft" data-testid={`account-line-${p}`}>
            {model.line}
          </span>
        </div>
      </div>

      {model.progress ? (
        <div role="status" className="flex items-center gap-3" data-testid={`account-progress-${p}`}>
          <span className="font-mono text-xs tracking-[0.1em] whitespace-nowrap text-cb-text">{model.progress.label}</span>
          <ProgressBar
            value={model.progress.value}
            max={model.progress.max}
            label={`${providerName(p)} import progress`}
            unit="games"
            className="flex-1"
          />
        </div>
      ) : null}

      {model.banner ? <CardBannerView provider={p} banner={model.banner} onRetry={onSync} /> : null}

      <SwitchRow
        label={AUTO_IMPORT_LABEL}
        description={model.autoImportHint}
        checked={model.autoImport}
        onCheckedChange={(v) => onAutoImport?.(v)}
        className="border-b border-cb-border-subtle vh700:min-h-12"
        data-testid={`account-autoimport-${p}`}
      />

      {confirmOpen ? (
        <DisconnectConfirm
          provider={p}
          importedCount={model.importedCount}
          pending={disconnectPending}
          error={disconnectError}
          onKeep={() => {
            onConfirmOpenChange?.(false);
            requestAnimationFrame(() => disconnectRef.current?.focus());
          }}
          onConfirm={(deleteGames) => onDisconnect?.(deleteGames)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {model.showSync ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (!model.syncDisabled) onSync?.();
              }}
              aria-disabled={model.syncDisabled || undefined}
              className={cn(model.syncDisabled && "cursor-not-allowed text-cb-text-disabled hover:bg-cb-surface")}
              iconStart={model.syncLabel === "Syncing…" ? <Spinner /> : <RefreshCw aria-hidden="true" />}
              data-testid={`account-sync-${p}`}
            >
              {model.syncLabel}
            </Button>
          ) : null}
          <Button
            ref={disconnectRef}
            variant="text"
            className="text-cb-bad"
            onClick={() => onConfirmOpenChange?.(true)}
            data-testid={`account-disconnect-open-${p}`}
          >
            Disconnect
          </Button>
        </div>
      )}

      {syncError ? (
        <p
          role={syncError === "failed" ? "alert" : "status"}
          className={cn("m-0 text-ui", syncError === "failed" ? "text-cb-bad" : "text-cb-text-soft")}
          data-testid={`account-sync-error-${p}`}
        >
          {syncError === "paywall" ? WAITING_FOR_TRIAL : SYNC_START_FAILED}
        </p>
      ) : null}
    </>
  );
}

function CardBannerView({ provider, banner, onRetry }: { provider: ProviderSlug; banner: CardBanner; onRetry?: () => void }) {
  const testId = `account-banner-${provider}`;
  switch (banner.kind) {
    case "sync_failed":
      return (
        <Banner
          tone="bad"
          live="assertive"
          data-testid={testId}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry} data-testid={`account-retry-${provider}`}>
              Try again
            </Button>
          }
        >
          {banner.text}
        </Banner>
      );
    case "rate_limited": {
      const copy = rateLimitedCopy(provider);
      return (
        <Banner tone="warn" data-testid={testId}>
          {copy.before}
          <span role="timer" aria-live="off" className="font-mono tabular-nums" data-testid={`account-countdown-${provider}`}>
            {mmss(banner.secondsLeft)}
          </span>
          {copy.after}
        </Banner>
      );
    }
    case "private_games":
      return (
        <Banner
          tone="warn"
          data-testid={testId}
          action={
            <Link href={HELP_IMPORTING_HREF} className={buttonVariants({ variant: "text", size: "sm" })}>
              Why?
            </Link>
          }
        >
          {banner.text}
        </Banner>
      );
    case "closed":
    case "gone":
      return (
        <Banner tone="bad" live="assertive" data-testid={testId}>
          {banner.text}
        </Banner>
      );
    case "waiting":
      return (
        <Banner tone="info" data-testid={testId}>
          {banner.text}
        </Banner>
      );
  }
}
