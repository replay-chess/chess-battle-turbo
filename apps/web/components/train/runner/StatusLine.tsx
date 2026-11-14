"use client";

// The status line ("White to move", "Not quite.", "Correct."): the first line of the live region. After a grade the
// runner moves focus here (§4.4 "After a grade, focus moves to the next item's status line"), so it is focusable.
import { forwardRef } from "react";

export const StatusLine = forwardRef<HTMLParagraphElement, { text: string }>(function StatusLine({ text }, ref) {
  return (
    <p ref={ref} className="tr-status" tabIndex={-1} data-testid="trainer-status">
      {text}
    </p>
  );
});
