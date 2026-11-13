// The /games source tabs and import banner (phase-04 plan §4.11; DR/V3GamesArchive.dc.html `.tabs`, `import_running`).
// Pure and zod-free: the screen, the demo and the unit tests share the rules.
//
// Tabs: `All · Replay Chess · Chess.com · Lichess` with counts from G1's page-1 `meta.counts`. A provider tab is
// shown when it has games or the member linked that provider (and the tab that is open always stays); with no
// provider tab the row is not drawn at all (a Replay-only archive looks exactly like P3's). `import-v3` off: no tabs.
import type { ImportStatusData } from "@repo/contracts/http/import";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import type { GameSourceWire } from "@repo/contracts/http/review";
import { importingLabel, providerName } from "@/components/accounts/copy";

export type SourceCounts = { replay: number; chesscom: number; lichess: number };

export type SourceTabId = "all" | GameSourceWire;
export type SourceTab = { id: SourceTabId; label: string; count: number };

const LABEL: Record<SourceTabId, string> = { all: "All", replay: "Replay Chess", chesscom: "Chess.com", lichess: "Lichess" };

export function sourceLabel(id: SourceTabId): string {
  return LABEL[id];
}

export function sourceTabs(input: {
  enabled: boolean;
  all: number | null;
  counts: SourceCounts | null;
  linked: readonly ProviderSlug[];
  current: GameSourceWire | undefined;
}): SourceTab[] | null {
  if (!input.enabled || input.all === null || input.counts === null) return null;
  const counts = input.counts;
  const providers = (["chesscom", "lichess"] as const).filter(
    (p) => counts[p] > 0 || input.linked.includes(p) || input.current === p,
  );
  if (!providers.length) return null;
  return [
    { id: "all", label: LABEL.all, count: input.all },
    { id: "replay", label: LABEL.replay, count: counts.replay },
    ...providers.map((p) => ({ id: p, label: LABEL[p], count: counts[p] })),
  ];
}

/** The `import_running` banner: the newest queued or running run (a run waiting for the trial is not importing). */
export type ImportBannerModel = { label: string; value: number; max: number; provider: string };

export function importBannerOf(status: ImportStatusData | undefined): ImportBannerModel | null {
  const run = status?.runs.find((r) => r.status === "running" || r.status === "queued");
  if (!run) return null;
  return {
    label: importingLabel(run.imported, run.total),
    value: run.imported,
    max: run.total ?? 0,
    provider: providerName(run.provider),
  };
}
