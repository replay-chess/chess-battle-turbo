"use client";

// Report a Problem (§4.4 menu, §7.1 W7 `POST /api/reports`): a reason and an optional note (≤ 500 characters). The
// item is skipped at once (optimistic); the report is idempotent per item. Loaded lazily (next/dynamic) on first open,
// so the runner's first load carries none of it (§9.5).
import { useState } from "react";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import type { ReportReason } from "./context";

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  wrong_solution: "The solution is wrong",
  better_move: "There is a better move",
  illegal_move: "A move is illegal",
  text_wrong: "The explanation is wrong",
  other: "Something else",
};

export const REPORT_NOTE_LIMIT = 500;

export default function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: ReportReason, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ReportReason>("wrong_solution");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Report a Problem" size="sm" data-testid="trainer-report">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          void onSubmit(reason, note.trim()).finally(() => setBusy(false));
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="tr-lbl pb-2">What is wrong?</legend>
          {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-ui">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-cb-accent" />
              {REPORT_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-ui">
          <span>Anything else we should know? (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, REPORT_NOTE_LIMIT))}
            rows={3}
            maxLength={REPORT_NOTE_LIMIT}
            className="min-h-24 w-full resize-y border border-cb-border-input bg-cb-surface p-3 text-ui text-cb-text"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="tr-btn-s" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="submit" className="tr-btn-p" aria-busy={busy || undefined} disabled={busy}>
            Send Report
          </button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
