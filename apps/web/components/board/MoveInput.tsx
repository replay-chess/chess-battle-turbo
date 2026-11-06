"use client";

/**
 * Text move entry (P2 plan §4.5.1, §4.5.3 rule 8): "Type a move, for example
 * Nf3". Accepts SAN or UCI through the parent's `resolve` (the same rules and
 * reasons as the board), shows the reason when a move is refused. Visually
 * hidden until it has focus (or `visible`, a P10 setting), and not shown on
 * touch-first devices.
 */
import { useId, useState } from "react";
import type { BoardMove } from "./types";

export type MoveInputResult = { ok: true; move: BoardMove } | { ok: false; reason: string };

export function MoveInput({
  resolve,
  onMove,
  disabled = false,
  visible = false,
  label = "Type a move",
  placeholder = "Type a move, for example Nf3",
}: {
  resolve: (text: string) => MoveInputResult;
  onMove: (m: BoardMove) => void;
  disabled?: boolean;
  visible?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    const r = resolve(value);
    if (r.ok) {
      setText("");
      setError(null);
      onMove(r.move);
    } else {
      setError(r.reason);
    }
  };

  return (
    <form className="rc-bd-moveinput" data-visible={visible ? "" : undefined} data-testid="move-input" onSubmit={submit}>
      <label htmlFor={`${id}-in`} className="text-ui text-cb-text-soft">
        {label}
      </label>
      <input
        id={`${id}-in`}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        className="min-h-11 border border-cb-border-strong bg-cb-surface px-3 font-mono text-ui text-cb-text placeholder:text-cb-text-muted"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
      />
      <p id={`${id}-err`} role="status" aria-live="polite" className="min-h-5 text-ui text-cb-bad">
        {error ?? ""}
      </p>
    </form>
  );
}
