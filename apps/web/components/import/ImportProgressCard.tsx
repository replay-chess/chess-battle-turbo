"use client";

// ImportProgressCard (phase-04 plan §4.7, §4.8, §5.2, §5.7; V3OnbActivating, V3OnbDone and their iPhone / iPad
// variants): the import of the member's linked account, shown on Activating and Done.
//
// - `ImportProgressCard` renders a view from lib/onboarding/import-card.ts (the demo routes pass fixtures).
// - `LiveImportProgressCard` keeps it current: `qk.imports()` (seeded by the page's RSC) is patched by the socket's
//   `import:*` / `analysis:done` events (useImportProgress, which also measures the ETA from the last three progress
//   frames), and polled over HTTP only while the socket is not live and a run is queued or running (useImportStatus,
//   the §5.7 fallback: 3 s × 10, then 10 s, for 10 min). Retry Import = POST /api/import/{ref}/retry (optimistic
//   `queued`); a 402 shows "Importing starts when your trial begins.", a 429 the countdown.
//
// a11y: the card is a polite live region (the board's `aria-live="polite"`); the bars are progressbars with a value
// text, so the count is not announced twice.
import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";
import { RetryCountdown } from "@/components/system/RetryCountdown";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { isApiError } from "@/lib/api/errors";
import { useRetryImport } from "@/lib/api/mutations/imports";
import { currentRun, useImportStatus } from "@/lib/api/queries/imports";
import { SETTINGS_CONNECTED_PATH, SETTINGS_LINK_TEXT, importCardView, type ImportCardInput, type ImportCardView } from "@/lib/onboarding/import-card";
import { useImportProgress } from "@/lib/realtime/useImportProgress";
import { cn } from "@/lib/utils";

export type ImportProgressCardProps = {
  view: ImportCardView;
  /** Retry Import (shown whenever the view offers it; the demo routes pass none). */
  onRetry?: () => void;
  retrying?: boolean;
  /** Under the retry button: the 429 countdown or a 402 note. */
  retryNote?: React.ReactNode;
  /** Spread on the retry button (the countdown's aria-disabled / aria-describedby). */
  retryControlProps?: { "aria-disabled"?: true; "aria-describedby"?: string };
  className?: string;
};

function IndeterminateBar({ text }: { text: string }) {
  return (
    <div role="progressbar" aria-label="Game import" aria-valuetext={text} className="relative h-1 w-full overflow-hidden bg-cb-border" data-testid="import-bar">
      <span className="absolute inset-y-0 left-0 animate-rc-hair bg-cb-accent motion-reduce:w-[62%] motion-reduce:animate-none" />
    </div>
  );
}

export function ImportProgressCard({ view, onRetry, retrying, retryNote, retryControlProps, className }: ImportProgressCardProps) {
  const bad = view.tone === "bad";
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2 border border-cb-border bg-cb-surface px-4 py-3.5 text-cb-text [@media(max-height:640px)]:py-2.5", className)}
      aria-live="polite"
      data-testid="import-progress-card"
      data-state={view.state}
      data-board-state={view.boardState ?? undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        {bad ? (
          <span className="flex min-w-0 items-start gap-2 text-sm font-medium text-cb-bad" data-testid="import-label">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{view.label}</span>
          </span>
        ) : (
          <span className="text-overline min-w-0 [overflow-wrap:anywhere]" data-testid="import-label">
            {view.label}
          </span>
        )}
        {view.count ? (
          <span className="shrink-0 font-mono text-xs tabular-nums" data-testid="import-count">
            {view.count}
          </span>
        ) : null}
      </div>
      {view.bar?.kind === "determinate" ? (
        <ProgressBar value={view.bar.value} max={view.bar.max} label="Game import" unit="games" data-testid="import-bar" />
      ) : view.bar?.kind === "indeterminate" ? (
        <IndeterminateBar text={view.bar.text} />
      ) : null}
      <span className="text-xs leading-[1.4] text-cb-text-soft" data-testid="import-hint">
        {view.hint}
        {view.settingsLink ? (
          <>
            {" "}
            {/* inline-block + 4 px padding: a 24 px tap target inside the sentence (regression: done-settings-link-target). */}
            <Link href={SETTINGS_CONNECTED_PATH} className="inline-block py-1 text-cb-text underline underline-offset-2">
              {SETTINGS_LINK_TEXT}
            </Link>
            .
          </>
        ) : null}
      </span>
      {view.retry ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={onRetry}
          loading={retrying}
          iconStart={<RotateCw aria-hidden="true" />}
          {...retryControlProps}
          data-testid="import-retry"
        >
          Retry Import
        </Button>
      ) : null}
      {retryNote}
    </div>
  );
}

export type LiveImportProgressCardProps = Omit<ImportCardInput, "run" | "firstReview" | "etaSec"> & {
  /** onb_import_retry_clicked etc. */
  onRetryClick?: (provider: "chesscom" | "lichess") => void;
  className?: string;
};

/** The card on live data (Activating, Done). The page seeds `qk.imports()` through its HydrationBoundary. */
export function LiveImportProgressCard({ onRetryClick, className, ...input }: LiveImportProgressCardProps) {
  const status = useImportStatus();
  const { etaSec } = useImportProgress();
  const retry = useRetryImport();
  const limit = useRetryCountdown(retry, { routeId: "import.retry" });
  const run = currentRun(status.data);
  const view = importCardView({ ...input, run, firstReview: status.data?.firstReview ?? null, etaSec });

  const paywalled = isApiError(retry.error) && retry.error.status === 402;
  const onRetry = () => {
    if (!run || retry.isPending || limit.limited) return;
    onRetryClick?.(run.provider);
    retry.mutate(run.ref);
  };

  return (
    <ImportProgressCard
      view={view}
      onRetry={onRetry}
      retrying={retry.isPending}
      retryControlProps={limit.controlProps}
      className={className}
      retryNote={
        <>
          <RetryCountdown countdown={limit} data-testid="import-retry-countdown" />
          {paywalled ? (
            <p className="m-0 text-xs text-cb-text-soft" data-testid="import-retry-paywall">
              Importing starts when your trial begins.
            </p>
          ) : null}
        </>
      }
    />
  );
}
