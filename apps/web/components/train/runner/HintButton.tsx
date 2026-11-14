"use client";

// Hint → Show Arrow → Hint Used (§4.4 footer controls; key H). The first press rings the piece, the second draws the
// arrow; both count the item as Hard.
import { Lightbulb } from "lucide-react";

export function HintButton({ label, disabled, onHint, testId = "trainer-hint" }: { label: string; disabled: boolean; onHint: () => void; testId?: string }) {
  return (
    <button type="button" className="tr-btn-s" onClick={onHint} disabled={disabled} aria-keyshortcuts="H" data-testid={testId}>
      <Lightbulb aria-hidden="true" size={16} />
      {label}
    </button>
  );
}
