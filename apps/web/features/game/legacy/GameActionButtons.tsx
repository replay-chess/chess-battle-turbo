import { cn } from "@/lib/utils";

interface GameActionButtonsProps {
  variant: "mobile" | "desktop";
  drawOffered: boolean;
  onOfferDraw: () => void;
  onResign: () => void;
}

export function GameActionButtons({
  variant,
  drawOffered,
  onOfferDraw,
  onResign,
}: GameActionButtonsProps) {
  if (variant === "mobile") {
    return (
      <div className="lg:hidden flex items-center justify-center gap-2 mt-1 sm:mt-3 px-2">
        <button
          onClick={onOfferDraw}
          disabled={drawOffered}
          className={cn(
            "h-8 sm:h-10 px-3 sm:px-5 text-sm border transition-colors",
            drawOffered
              ? "border-cb-border text-cb-text-muted cursor-not-allowed bg-cb-hover"
              : "border-cb-border-strong text-cb-text bg-cb-hover hover:bg-cb-surface-elevated active:bg-cb-surface-elevated"
          )}
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          {drawOffered ? "Offered" : "Draw"}
        </button>
        <button
          data-testid="resign-button"
          onClick={onResign}
          className="h-8 sm:h-10 px-3 sm:px-5 text-sm border border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/25 transition-colors"
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          Resign
        </button>
      </div>
    );
  }

  return (
    <div className="border border-cb-border p-5 space-y-3">
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted"
      >
        Game Actions
      </p>
      <button
        onClick={onOfferDraw}
        disabled={drawOffered}
        className={cn(
          "w-full py-2 border transition-colors",
          drawOffered
            ? "border-cb-border text-cb-text-muted cursor-not-allowed"
            : "border-cb-border-strong text-cb-text-secondary hover:border-cb-text-muted hover:text-cb-text"
        )}
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        {drawOffered ? "Draw Offered" : "Offer Draw"}
      </button>
      <button
        data-testid="resign-button"
        onClick={onResign}
        className="w-full py-2 border border-red-500/30 text-red-400/60 hover:border-red-500/50 hover:text-red-400 transition-colors"
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        Resign
      </button>
    </div>
  );
}
