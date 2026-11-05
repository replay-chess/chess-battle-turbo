"use client";

// notify API (SPEC 7.2, 02 §5.19). The box styles live only in the Toaster's
// classNames.toast (ThemeAwareToaster.tsx), which sonner applies to every toast,
// so notify toasts and the legacy toast.success/error calls look the same.
// Copy: one sentence, object first, no trailing period.
import { Check, Info, TriangleAlert, Trophy, Undo2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TOAST_TYPES, type ToastIconName, type ToastTone, type ToastType } from "./toast-config";

export type NotifyOptions = {
  action?: { label: string; onClick: () => void };
  /** Undo toasts: the "Undo" action. */
  onUndo?: () => void;
  /** Replaces a toast with the same id instead of stacking. */
  id?: string | number;
};

const ICONS: Record<ToastIconName, typeof Check> = { Check, Info, TriangleAlert, WifiOff, Trophy, Undo2 };

const TONE_CLASS: Record<ToastTone, string> = {
  good: "text-cb-good",
  text: "text-cb-text",
  bad: "text-cb-bad",
  warn: "text-cb-warn",
  accent: "text-cb-accent",
};

/**
 * The toast text plus the timer bar. No role: sonner's list is already
 * aria-live="polite", so a role here would announce twice. Dismissal comes from
 * sonner's JS timer; the bar is decoration and pauses with it (toast.css).
 */
export function ToastBody({ text, duration }: { text: React.ReactNode; duration: number }) {
  return (
    <>
      <span className="block min-w-0 flex-1">{text}</span>
      <span
        aria-hidden="true"
        className="rc-toast-timer pointer-events-none absolute bottom-0 left-0 h-0.5 w-full origin-left bg-cb-accent/50 motion-reduce:hidden"
        style={{ animationDuration: `${duration}ms` }}
      />
    </>
  );
}

function show(type: ToastType, text: React.ReactNode, opts: NotifyOptions = {}) {
  const { duration, icon: iconName, tone } = TOAST_TYPES[type];
  const Icon = ICONS[iconName];
  const action =
    type === "undo"
      ? opts.onUndo
        ? { label: "Undo", onClick: opts.onUndo }
        : opts.action
          ? { label: "Undo", onClick: opts.action.onClick }
          : undefined
      : opts.action;
  const data = {
    icon: <Icon aria-hidden="true" className={cn("size-4", TONE_CLASS[tone])} />,
    action,
    duration,
    id: opts.id,
    testId: `toast-${type}`,
  };
  const body = <ToastBody text={text} duration={duration} />;
  switch (type) {
    case "success":
      return toast.success(body, data);
    case "info":
      return toast.info(body, data);
    case "error":
      return toast.error(body, data);
    case "warning":
      return toast.warning(body, data);
    default:
      // achievement and undo use the plain toast().
      return toast(body, data);
  }
}

export const notify = {
  success: (text: React.ReactNode, opts?: NotifyOptions) => show("success", text, opts),
  info: (text: React.ReactNode, opts?: NotifyOptions) => show("info", text, opts),
  error: (text: React.ReactNode, opts?: NotifyOptions) => show("error", text, opts),
  warning: (text: React.ReactNode, opts?: NotifyOptions) => show("warning", text, opts),
  achievement: (text: React.ReactNode, opts?: NotifyOptions) => show("achievement", text, opts),
  undo: (text: React.ReactNode, opts?: NotifyOptions) => show("undo", text, opts),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
