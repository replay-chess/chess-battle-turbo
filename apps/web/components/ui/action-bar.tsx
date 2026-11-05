"use client";

// ActionBar (SPEC 6.2; 02 §5.18 `.ibar`): the decision bar for draw offers and
// rematches. Decisions belong here, never in a toast.
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

export type ActionBarProps = {
  /** incoming → role="alert" (an offer the player must answer); outgoing → role="status". */
  direction: "incoming" | "outgoing";
  /** The message, sentence case ("Your opponent offers a draw."). */
  children: React.ReactNode;
  /** ActionBarButton elements. */
  actions?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function ActionBar({ direction, children, actions, className, "data-testid": testId }: ActionBarProps) {
  return (
    <div
      role={direction === "incoming" ? "alert" : "status"}
      data-direction={direction}
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-cb-border bg-cb-fill py-2 pr-2.5 pl-3 text-ui text-cb-text animate-rc-in-bottom motion-reduce:animate-none",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A 40px bar button (44 on coarse pointers): `control` for secondary choices, `primary` for the main one. */
export function ActionBarButton({
  variant = "control",
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size"> & { variant?: "control" | "primary" }) {
  return (
    <Button
      variant={variant}
      className={cn("tap-target min-h-10 pointer-coarse:min-h-11", variant === "primary" && "px-3.5", className)}
      {...props}
    />
  );
}
