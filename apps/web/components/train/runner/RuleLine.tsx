"use client";

// "Solved first try: back in 4 days. Missed: back in under 10 minutes." from the item's own previews (bank items with
// a schedule; practice items have none).
import type { GradePreviews } from "@repo/contracts/http/train";
import { Clock } from "lucide-react";

export function ruleText(preview: GradePreviews): string {
  const missed = preview.again.label.startsWith("<") ? `under ${preview.again.label.replace(/^<\s*/, "").replace(/min$/, "minutes")}` : preview.again.label;
  return `Solved first try: back in ${preview.good.label}. Missed: back in ${missed}.`;
}

export function RuleLine({ preview }: { preview: GradePreviews }) {
  return (
    <div className="tr-rule tr-tall">
      <Clock aria-hidden="true" size={16} />
      <span>{ruleText(preview)}</span>
    </div>
  );
}
