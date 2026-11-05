"use client";

// Banner (SPEC 3.5, 6.2; 02 §5.6, C11): V4 tinted tones, status-coloured icon, cb-text body.
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type BannerProps = {
  tone?: "info" | "good" | "warn" | "bad";
  /** bar = `.banner` (13px, one line); note = `.note` (14px, multi-line). Default bar. */
  layout?: "bar" | "note";
  /** Default per tone; false hides it. */
  icon?: React.ReactNode | false;
  title?: React.ReactNode;
  /** Usually <Button size="sm" variant="secondary">. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Default "Dismiss for this session". */
  dismissLabel?: string;
  /** role status | alert | none; default polite. Never role="banner" (a landmark). */
  live?: "polite" | "assertive" | "off";
  className?: string;
  "data-testid"?: string;
  children: React.ReactNode;
};

const TONE_ICON = {
  info: Info,
  good: CircleCheck,
  warn: TriangleAlert,
  bad: CircleAlert,
} as const;

// flex-wrap: on a narrow phone (262px at 150% zoom) the text keeps a 12rem basis and the action and dismiss
// wrap onto a second line, right-aligned, instead of squeezing the message to one word per line.
const bannerVariants = cva("flex flex-wrap gap-x-2.5 gap-y-3 border px-3.5 text-cb-text", {
  variants: {
    layout: {
      bar: "items-center py-2.5 text-ui",
      note: "items-start py-3 text-sm leading-[1.45]",
    },
    tone: {
      info: "border-cb-border bg-cb-surface",
      good: "border-cb-good/45 bg-cb-good-bg",
      warn: "border-cb-warn/45 bg-cb-warn-bg",
      bad: "border-cb-bad/45 bg-cb-bad-bg",
    },
  },
  defaultVariants: { layout: "bar", tone: "info" },
});

const ICON_TONE = {
  info: "text-cb-text",
  good: "text-cb-good",
  warn: "text-cb-warn",
  bad: "text-cb-bad",
} as const;

/**
 * An inline status message. Only the icon takes the status colour; the text
 * stays cb-text, so the tone never depends on colour alone.
 */
export function Banner({
  tone = "info",
  layout = "bar",
  icon,
  title,
  action,
  onDismiss,
  dismissLabel,
  live = "polite",
  className,
  "data-testid": testId,
  children,
}: BannerProps) {
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;
  const ToneIcon = TONE_ICON[tone];
  const glyph = icon === false ? null : (icon ?? <ToneIcon />);
  // In the one-line bar the 36px controls tuck into the padding, so the bar stays 44px tall.
  const tuck = layout === "bar" ? "-my-1.5" : "-my-1";
  return (
    <div
      role={role}
      data-tone={tone}
      data-layout={layout}
      data-testid={testId}
      className={cn(bannerVariants({ layout, tone }), className)}
    >
      {glyph ? (
        <span
          aria-hidden="true"
          className={cn("inline-flex shrink-0 [&_svg]:size-4", ICON_TONE[tone], layout === "note" && "pt-0.5")}
        >
          {glyph}
        </span>
      ) : null}
      <div className="min-w-0 grow basis-48">
        {title ? <p className="font-medium">{title}</p> : null}
        <div>{children}</div>
      </div>
      {action ? <div className={cn("ml-auto flex shrink-0 items-center gap-2", tuck)}>{action}</div> : null}
      {onDismiss ? (
        <IconButton
          size="sm"
          variant="ghost"
          label={dismissLabel ?? "Dismiss for this session"}
          icon={<X />}
          onClick={onDismiss}
          className={cn(tuck, "-mr-1.5", !action && "ml-auto")}
        />
      ) : null}
    </div>
  );
}
