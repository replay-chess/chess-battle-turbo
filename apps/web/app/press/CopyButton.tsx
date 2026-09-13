"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the
      // text is on screen, so selecting it by hand still works.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      style={{ fontFamily: "'Geist', sans-serif" }}
      className="shrink-0 text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 border border-cb-border text-cb-text-muted hover:text-cb-text hover:border-cb-border-strong transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
