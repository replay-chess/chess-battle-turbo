import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export type DemoContentKind = "page" | "list" | "empty";

const CARDS = [
  { title: "Rapid 10+0", body: "A full game with time to think." },
  { title: "Blitz 5+3", body: "Quick games with a small increment." },
  { title: "Legend Positions", body: "Play on from a famous position." },
];

/**
 * Demo page content for /dev/ui/shell. A lock-mode page: it must fit one
 * viewport at every device × zoom project (P5's one-viewport suite).
 */
export function DemoContent({ content }: { content: DemoContentKind }) {
  if (content === "empty") {
    return (
      <div data-rc-lock="" className="flex min-h-0 items-center justify-center overflow-hidden p-4 sm:p-6">
        <EmptyState
          title="No Tournaments Right Now"
          body="New tournaments appear here as soon as they open."
          icon={<Trophy aria-hidden="true" size={20} />}
          ghostRows={0}
          className="max-w-md"
        />
      </div>
    );
  }

  if (content === "list") {
    return (
      <div data-rc-lock="" className="flex min-h-0 flex-col gap-3 p-4 sm:p-6">
        <PageHeader overline="Demo" title="Shell Demo" />
        <div
          data-rc-scroll=""
          tabIndex={0}
          role="region"
          aria-label="Demo list"
          className="min-h-0 flex-1 overflow-y-auto border border-cb-border"
        >
          <ul>
            {Array.from({ length: 60 }, (_, i) => (
              <li
                key={i}
                className="flex h-14 items-center justify-between gap-3 border-b border-cb-border-subtle px-4 text-body text-cb-text"
              >
                <span className="truncate">Demo Row {i + 1}</span>
                <span className="font-mono text-xs text-cb-text-soft">{String(i + 1).padStart(2, "0")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div data-rc-lock="" className="flex min-h-0 flex-col gap-4 overflow-hidden p-4 sm:p-6">
      <PageHeader overline="Demo" title="Shell Demo" />
      <input
        aria-label="Demo search"
        data-testid="shell-demo-input"
        placeholder="Type here to test shortcuts"
        className="h-11 w-full max-w-sm shrink-0 border border-cb-border-input bg-cb-surface px-3 text-body text-cb-text pointer-coarse:text-base"
      />
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] grid-cols-3 gap-3 tabbar:grid-cols-1 vh620:hidden">
        {CARDS.map((card) => (
          <section key={card.title} className="min-h-0 overflow-hidden border border-cb-border bg-cb-surface p-4">
            <h2 className="text-body font-medium text-cb-text">{card.title}</h2>
            <p className="text-ui text-cb-text-soft">{card.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
