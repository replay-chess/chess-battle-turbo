// The countdown ring of the zones and the disconnect chip (36×36 viewBox, r = 15, as in the V3Game boards).

import { RING_LENGTH } from "../clock/useCountdown";

export function Ring({ size, progress, tone }: { size: number; progress: number; tone?: "warn" }) {
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true" style={{ flex: "none" }}>
      <g className="g-ring" data-tone={tone}>
        <circle className="g-ring__track" cx="18" cy="18" r="15" />
        <circle
          className="g-ring__bar"
          cx="18"
          cy="18"
          r="15"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={(RING_LENGTH * progress).toFixed(2)}
        />
      </g>
    </svg>
  );
}
