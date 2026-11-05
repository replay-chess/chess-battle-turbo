import { ArrowRight, Plus, Search, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/count-badge";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd, ModKey } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { GallerySection, Specimen } from "../_components/Specimen";

const NEUTRALS = [
  "cb-bg",
  "cb-bg-pure",
  "cb-surface",
  "cb-surface-elevated",
  "cb-fill",
  "cb-text",
  "cb-text-secondary",
  "cb-text-soft",
  "cb-text-muted",
  "cb-text-disabled",
  "cb-text-faint",
  "cb-border-subtle",
  "cb-border",
  "cb-border-strong",
  "cb-border-dashed",
  "cb-border-input",
  "cb-accent",
  "cb-accent-hover",
  "cb-accent-fg",
  "cb-hover",
  "cb-scrim",
  "cb-scrim-modal",
];

const STATUS = [
  { tone: "good", label: "Good" },
  { tone: "warn", label: "Warning" },
  { tone: "bad", label: "Error" },
] as const;

const CHESS = [
  "board-light-edge",
  "board-light-center",
  "board-dark-edge",
  "board-dark-center",
  "board-capture",
  "board-last-move",
  "highlight-green",
  "highlight-red",
  "highlight-blue",
  "highlight-orange",
  "highlight-purple",
  "highlight-yellow",
  "pv-1",
  "pv-2",
  "pv-3",
  "pv-4",
  "pv-5",
  "mq-brilliant",
  "mq-great",
  "mq-best",
  "mq-excellent",
  "mq-good",
  "mq-book",
  "mq-forced",
  "mq-interesting",
  "mq-inaccuracy",
  "mq-mistake",
  "mq-miss",
  "mq-blunder",
];

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex w-28 flex-col gap-1.5">
      <span
        data-token={token}
        className="block h-12 w-full border border-cb-border"
        style={{ background: `var(--${token})` }}
      />
      <code className="font-mono text-2xs text-cb-text-soft">{token}</code>
    </div>
  );
}

export function FoundationsSection() {
  return (
    <GallerySection id="foundations" title="Foundations">
      <Specimen title="Neutrals" testId="ui-tokens-neutrals">
        {NEUTRALS.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </Specimen>

      <Specimen title="Status" testId="ui-tokens-status">
        {STATUS.map(({ tone, label }) => (
          <span
            key={tone}
            data-token={`cb-${tone}`}
            className="inline-flex min-h-11 items-center px-3.5 text-ui font-medium"
            style={{ color: `var(--cb-${tone})`, background: `var(--cb-${tone}-bg)` }}
          >
            {label} text on its tint
          </span>
        ))}
      </Specimen>

      <Specimen title="Chess" testId="ui-tokens-chess">
        {CHESS.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </Specimen>

      <Specimen title="Type Scale" testId="ui-type-scale" className="[&>div]:flex-col">
        <p className="font-serif text-title">Title · Instrument Serif</p>
        <p className="font-serif text-heading">Heading · Instrument Serif</p>
        <p className="text-body">Body · Geist 15px</p>
        <p className="text-ui">UI · Geist 13px</p>
        <p className="text-label">Label · 11px</p>
        <p className="text-2xs">2xs · 10px</p>
        <p className="text-overline">Overline</p>
        <p className="text-eyebrow">Eyebrow</p>
        <p className="font-serif text-wordmark">ReplayChess</p>
        <p className="font-mono text-ui tabular-nums">Mono · 1184 · 05:00</p>
      </Specimen>

      <Specimen title="Button Primary" testId="ui-button-primary">
        <Button>Play Now</Button>
        <Button iconEnd={<ArrowRight />}>Continue</Button>
      </Specimen>
      <Specimen title="Button Secondary" testId="ui-button-secondary">
        <Button variant="secondary">Cancel</Button>
        <Button variant="secondary" iconStart={<Plus />}>
          New Game
        </Button>
      </Specimen>
      <Specimen title="Button Text" testId="ui-button-text">
        <Button variant="text">Clear Search</Button>
      </Specimen>
      <Specimen title="Button Danger" testId="ui-button-danger">
        <Button variant="danger">Resign</Button>
      </Specimen>
      <Specimen title="Button Danger Outline" testId="ui-button-danger-outline">
        <Button variant="danger-outline">Delete Account</Button>
      </Specimen>
      <Specimen title="Button Control" testId="ui-button-control">
        <Button variant="control">Offer Draw</Button>
        <Button variant="control" aria-expanded="true">
          Menu Open
        </Button>
      </Specimen>
      <Specimen title="Button Sizes" testId="ui-button-sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Specimen>
      <Specimen title="Button Loading" testId="ui-button-loading">
        <Button loading loadingLabel="Creating Game…">
          Create Game
        </Button>
      </Specimen>
      <Specimen title="Button Disabled" testId="ui-button-disabled">
        <Button disabled>Play Now</Button>
        <Button variant="secondary" disabled>
          Cancel
        </Button>
      </Specimen>
      <Specimen title="Button Pressed" testId="ui-button-pressed">
        <Button variant="secondary" pressed>
          Pressed
        </Button>
        <Button variant="secondary" pressed={false}>
          Not Pressed
        </Button>
      </Specimen>

      <Specimen title="Icon Button" testId="ui-icon-button">
        {(["outline", "ghost", "solid"] as const).map((variant) =>
          (["sm", "md", "lg"] as const).map((size) => (
            <IconButton
              key={`${variant}-${size}`}
              variant={variant}
              size={size}
              label={`Settings ${variant} ${size}`}
              icon={variant === "ghost" ? <X /> : variant === "solid" ? <Search /> : <Settings />}
            />
          )),
        )}
      </Specimen>

      <Specimen title="Kbd" testId="ui-kbd">
        <span className="inline-flex gap-1">
          <Kbd>
            <ModKey />
          </Kbd>
          <Kbd>K</Kbd>
        </span>
        <Kbd>Esc</Kbd>
        <Kbd>?</Kbd>
      </Specimen>

      <Specimen title="Spinner" testId="ui-spinner">
        <Spinner size="sm" />
        <Spinner />
        <Spinner label="Loading games" />
      </Specimen>

      <Specimen title="Count Badge" testId="ui-count-badge">
        <CountBadge count={1} label="1 unread" />
        <CountBadge count={12} tone="neutral" label="12 unread" />
        <CountBadge count={120} label="120 unread" />
      </Specimen>

      <Specimen title="Focus" testId="ui-focus-demo" note="Tab through: the ring is 2px solid text colour, 2px offset.">
        <div className="bg-cb-bg p-4">
          <Button variant="secondary">On Background</Button>
        </div>
        <div className="bg-cb-surface p-4">
          <Button variant="secondary">On Surface</Button>
        </div>
        <div className="bg-cb-accent p-4">
          <Button variant="secondary">On Accent</Button>
        </div>
      </Specimen>
    </GallerySection>
  );
}
