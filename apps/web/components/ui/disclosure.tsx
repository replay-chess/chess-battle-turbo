// Disclosure (SPEC 6.2; 02 §5.18 `details.qa`): native <details>, so it works with
// the keyboard and screen readers with no JS. For state that code must control
// (auto-opening coach comments), use Radix Collapsible instead.
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DisclosureProps = Omit<React.ComponentProps<"details">, "children"> & {
  summary: React.ReactNode;
  children: React.ReactNode;
  /** Classes for the content under the summary. */
  contentClassName?: string;
};

export function Disclosure({ summary, children, className, contentClassName, ...props }: DisclosureProps) {
  return (
    <details className={cn("group w-full", className)} {...props}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium text-cb-text [-webkit-tap-highlight-color:transparent] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-cb-text-soft transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className={cn("pb-3 text-body text-cb-text-soft", contentClassName)}>{children}</div>
    </details>
  );
}
