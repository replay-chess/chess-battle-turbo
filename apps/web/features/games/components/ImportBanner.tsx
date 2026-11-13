// The /games `import_running` slot (phase-04 plan §4.11; DR/V3GamesArchive.dc.html): "IMPORTING 212 / 480 ·
// [bar] · Chess.com" across the top of the list card while a run is queued or running. `role="status"`, so the
// first appearance is announced; the bar carries its own name and value. Fed by `qk.imports()` (the socket's
// `import:*` events keep it moving; the archive refetches its first page on `games:changed`).
import { ProgressBar } from "@/components/ui/progress";
import type { ImportBannerModel } from "../model/sources";

export function ImportBanner({ model }: { model: ImportBannerModel }) {
  return (
    <div
      role="status"
      data-testid="games-import-banner"
      className="flex shrink-0 items-center gap-3 border-b border-cb-border px-4 py-3 vh700:py-2 tabbar:px-3"
    >
      <span className="font-mono text-xs tracking-[0.1em] whitespace-nowrap text-cb-text">{model.label}</span>
      <ProgressBar value={model.value} max={model.max} label={`${model.provider} import progress`} unit="games" className="min-w-12 flex-1" />
      <span className="text-sm whitespace-nowrap text-cb-text-soft">{model.provider}</span>
    </div>
  );
}
