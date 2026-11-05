import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { DemoPlayer } from "./demo-data";

/**
 * A 48px player bar for the stage demo (SPEC 10.4): 32px avatar, name and
 * rating that truncate, and a mono clock in an 84x34 box. It fills the
 * BoardStage bar slot, whose height (48/44/40) comes from the stage.
 */
export function DemoPlayerBar({ player, active = false }: { player: DemoPlayer; active?: boolean }) {
  return (
    <div className="flex h-full w-full min-w-0 items-center gap-3">
      <Avatar name={player.name} size={32} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        <span className="min-w-0 truncate text-ui font-medium text-cb-text">{player.name}</span>
        <span className="shrink-0 font-mono text-label tabular-nums text-cb-text-soft">{player.rating}</span>
      </div>
      <span
        className={cn(
          "inline-flex h-[34px] w-[84px] shrink-0 items-center justify-center border font-mono text-ui tabular-nums",
          active ? "border-cb-accent bg-cb-accent text-cb-accent-fg" : "border-cb-border-strong bg-cb-surface text-cb-text",
        )}
      >
        {player.clock}
      </span>
    </div>
  );
}
