// PageHeader (SPEC 3.5, 6.2; 03 §7.2, README "Use space wisely"): overline, one
// serif title with an inline info slot, actions on the right. Padding tightens on
// narrow, short and phone viewports.
import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  overline?: React.ReactNode;
  title: React.ReactNode;
  /** Slot for <InfoButton> (P2); the README puts the description there. */
  info?: React.ReactNode;
  actions?: React.ReactNode;
  /** Default 1. */
  headingLevel?: 1 | 2;
  className?: string;
  "data-testid"?: string;
};

export function PageHeader({
  overline,
  title,
  info,
  actions,
  headingLevel = 1,
  className,
  "data-testid": testId,
}: PageHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <header
      data-testid={testId}
      className={cn(
        "flex items-end justify-between gap-4 px-8 pt-7 pb-6 narrow:px-6 vh700:px-6 vh700:pt-4 vh700:pb-3.5 tabbar:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {overline ? <p className="text-overline">{overline}</p> : null}
        <div className="flex min-w-0 items-center gap-2">
          <Heading className="min-w-0 font-serif text-title font-normal text-balance text-cb-text">{title}</Heading>
          {info ? <span className="inline-flex shrink-0 items-center">{info}</span> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
