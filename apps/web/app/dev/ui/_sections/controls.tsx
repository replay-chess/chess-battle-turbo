"use client";

// Gallery section "Controls" (SPEC 6.2): controls, data display and feedback from P1.
import { useState } from "react";
import Link from "next/link";
import { Check, Info, Play, Search, SlidersHorizontal, Swords } from "lucide-react";
import { ActionBar, ActionBarButton } from "@/components/ui/action-bar";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, CheckboxRow } from "@/components/ui/checkbox";
import { Chip, ChipGroup, RemovableChip } from "@/components/ui/chip";
import { Disclosure } from "@/components/ui/disclosure";
import { Divider, Eyebrow, Overline } from "@/components/ui/divider";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Slider, Textarea } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar, StackedBar } from "@/components/ui/progress";
import { RadioCard, RadioCardGroup } from "@/components/ui/radio-card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonPlayerBar, SkeletonRegion, SkeletonRow, SkeletonText } from "@/components/ui/skeleton";
import { Switch, SwitchRow } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { GallerySection, Specimen } from "../_components/Specimen";

const TIME_CONTROLS = ["1+0", "3+2", "5+3", "10+0", "15+10", "30+0"] as const;
const OVERFLOW_TABS = ["Overview", "Games", "Stats", "Milestones", "Openings"] as const;
const MISTAKE_TYPES = [
  { id: "blunders", label: "Blunders" },
  { id: "mistakes", label: "Mistakes" },
  { id: "inaccuracies", label: "Inaccuracies" },
] as const;

const GRID = "grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0";
const WIDE = "w-full";

export function ControlsSection() {
  return (
    <GallerySection id="controls" title="Controls">
      <SelectionControls />
      <TabSpecimens />
      <FieldSpecimens />
      <ToggleSpecimens />
      <BannerSpecimens />
      <DisplaySpecimens />
      <AvatarSpecimens />
      <LoadingSpecimens />
      <EmptySpecimens />
    </GallerySection>
  );
}

function SelectionControls() {
  const [rated, setRated] = useState(true);
  const [time, setTime] = useState<string>("5+3");
  const [filters, setFilters] = useState<string[]>(["Blunders", "Last 30 Days"]);
  const [colour, setColour] = useState("random");
  const [start, setStart] = useState("standard");
  return (
    <div className={GRID}>
      <Specimen title="Chip" testId="ui-chip" note="A standalone toggle. The last chip is disabled.">
        <Chip pressed={rated} onPressedChange={setRated}>
          Rated
        </Chip>
        <Chip defaultPressed={false}>
          <Swords aria-hidden="true" />
          Legends Only
        </Chip>
        <Chip size="sm">Small</Chip>
        <Chip disabled>Casual</Chip>
      </Specimen>
      <Specimen title="Chip Group · Time Control" testId="ui-chip-group" note="Single choice never deselects.">
        <ChipGroup
          type="single"
          value={time}
          onValueChange={setTime}
          aria-label="Time control"
          columns={3}
          mono
          className="w-[280px] max-w-full"
        >
          {TIME_CONTROLS.map((tc) => (
            <Chip key={tc} value={tc}>
              {tc}
            </Chip>
          ))}
        </ChipGroup>
      </Specimen>
      <Specimen title="Removable Chip" testId="ui-chip-removable">
        {filters.map((f) => (
          <RemovableChip key={f} onRemove={() => setFilters((all) => all.filter((x) => x !== f))}>
            {f}
          </RemovableChip>
        ))}
        {filters.length === 0 ? (
          <Button variant="text" onClick={() => setFilters(["Blunders", "Last 30 Days"])}>
            Reset Filters
          </Button>
        ) : null}
      </Specimen>
      <Specimen title="Segmented · Colour" testId="ui-segmented">
        <Segmented
          aria-label="Colour"
          value={colour}
          onValueChange={setColour}
          items={[
            { value: "white", label: "White" },
            { value: "random", label: "Random" },
            { value: "black", label: "Black" },
          ]}
        />
      </Specimen>
      <Specimen title="Segmented · Fill" testId="ui-segmented-fill" className="lg:col-span-2">
        <Segmented
          aria-label="Start from"
          fill
          value={start}
          onValueChange={setStart}
          items={[
            { value: "standard", label: "Standard Start" },
            { value: "legend", label: "Legend Position", icon: <Play /> },
            { value: "fen", label: "Custom FEN", disabled: true },
          ]}
        />
      </Specimen>
    </div>
  );
}

function TabSpecimens() {
  const [panel, setPanel] = useState("coach");
  return (
    <div className={GRID}>
      <Specimen title="Tabs · Underline" testId="ui-tabs-underline">
        <Tabs value={panel} onValueChange={setPanel} className={WIDE}>
          <TabsList aria-label="Game panel">
            <TabsTrigger value="coach">Coach</TabsTrigger>
            <TabsTrigger value="moves">Moves</TabsTrigger>
            <TabsTrigger value="engine">Engine</TabsTrigger>
          </TabsList>
          <TabsContent value="coach" className="pt-3 text-body">
            Coach panel: one idea per move, in plain words.
          </TabsContent>
          <TabsContent value="moves" className="pt-3 text-body">
            Moves panel: the full move list with quality marks.
          </TabsContent>
          <TabsContent value="engine" className="pt-3 text-body">
            Engine panel: the top three lines at depth 18.
          </TabsContent>
        </Tabs>
      </Specimen>
      <Specimen title="Tabs · Overline" testId="ui-tabs-overline">
        <Tabs variant="overline" defaultValue="today" className={WIDE}>
          <TabsList aria-label="Period">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="all">All Time</TabsTrigger>
          </TabsList>
          <TabsContent value="today" className="pt-3 text-body">
            Twelve positions reviewed today.
          </TabsContent>
          <TabsContent value="week" className="pt-3 text-body">
            Forty positions reviewed this week.
          </TabsContent>
          <TabsContent value="all" className="pt-3 text-body">
            Six hundred positions reviewed in all.
          </TabsContent>
        </Tabs>
      </Specimen>
      <Specimen title="Tabs · Segmented" testId="ui-tabs-segmented" note="Switches panels, so it is a tab list, not a radio group.">
        <Tabs variant="segmented" defaultValue="legend" className={WIDE}>
          <TabsList aria-label="Opponent">
            <TabsTrigger value="legend">Legend</TabsTrigger>
            <TabsTrigger value="bot">Bot</TabsTrigger>
            <TabsTrigger value="friend">Friend</TabsTrigger>
            <TabsTrigger value="online">Online</TabsTrigger>
          </TabsList>
          <TabsContent value="legend" className="pt-3 text-body">
            Play a position from a legend&apos;s game.
          </TabsContent>
          <TabsContent value="bot" className="pt-3 text-body">
            Play the engine at a strength you pick.
          </TabsContent>
          <TabsContent value="friend" className="pt-3 text-body">
            Send a link to a friend.
          </TabsContent>
          <TabsContent value="online" className="pt-3 text-body">
            Find an opponent near your rating.
          </TabsContent>
        </Tabs>
      </Specimen>
      <Specimen title="Tabs · Overflow" testId="ui-tabs-overflow" note="320px box: the row scrolls and the active tab stays in view.">
        <div className="w-[320px] max-w-full">
          <Tabs defaultValue="overview">
            <TabsList aria-label="Profile sections" fit="auto">
              {OVERFLOW_TABS.map((t) => (
                <TabsTrigger key={t} value={t.toLowerCase()}>
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
            {OVERFLOW_TABS.map((t) => (
              <TabsContent key={t} value={t.toLowerCase()} className="pt-3 text-body">
                {t} section.
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </Specimen>
    </div>
  );
}

function FieldSpecimens() {
  const [strength, setStrength] = useState(6);
  return (
    <div className={GRID}>
      <Specimen title="Field" testId="ui-field-default">
        <Field label="Display Name" className={WIDE}>
          <Input placeholder="How other players see you" autoComplete="off" />
        </Field>
      </Specimen>
      <Specimen title="Field · Error" testId="ui-field-error">
        <Field label="Username" hint="3 to 20 letters, numbers or underscores." error="Username is taken." required className={WIDE}>
          <Input defaultValue="magnus" autoComplete="off" />
        </Field>
      </Specimen>
      <Specimen title="Field · Hint" testId="ui-field-hint">
        <Field label="Email" hint="We send receipts here, nothing else." className={WIDE}>
          <Input type="email" placeholder="you@example.com" autoComplete="off" />
        </Field>
      </Specimen>
      <Specimen title="Field · Disabled" testId="ui-field-disabled">
        <Field label="Rating" hint="Set by your games." className={WIDE}>
          <Input defaultValue="1520" disabled />
        </Field>
      </Specimen>
      <Specimen title="Input · Search" testId="ui-input-search">
        <Field label="Search Legends" labelVariant="overline" className={WIDE}>
          <Input type="search" leadingIcon={<Search />} placeholder="Capablanca, Tal, Fischer…" autoComplete="off" />
        </Field>
      </Specimen>
      <Specimen title="Textarea" testId="ui-textarea">
        <Field label="Notes" hint="Only you can see these." className={WIDE}>
          <Textarea placeholder="What did you miss in this game?" />
        </Field>
      </Specimen>
      <Specimen title="Select" testId="ui-select">
        <Field label="Piece Set" className={WIDE}>
          <Select defaultValue="classic">
            <option value="classic">Classic</option>
            <option value="staunton">Staunton</option>
            <option value="minimal">Minimal</option>
          </Select>
        </Field>
      </Specimen>
      <Specimen title="Slider" testId="ui-slider">
        <Field label={`Strength · Level ${strength}`} className={WIDE}>
          <Slider
            min={1}
            max={10}
            step={1}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            ticks={["1", "5", "10"]}
          />
        </Field>
      </Specimen>
    </div>
  );
}

function ToggleSpecimens() {
  const [sound, setSound] = useState(true);
  const [singleKey, setSingleKey] = useState(true);
  const [types, setTypes] = useState<string[]>(["blunders"]);
  const [selected, setSelected] = useState(false);
  const [startFrom, setStartFrom] = useState("standard");
  const [theme, setTheme] = useState("walnut");
  const all = types.length === MISTAKE_TYPES.length ? true : types.length === 0 ? false : "indeterminate";
  return (
    <div className={GRID}>
      <Specimen title="Switch" testId="ui-switch" note="The second switch is disabled.">
        <Switch checked={sound} onCheckedChange={setSound} aria-label="Sound" />
        <Switch checked={false} disabled aria-label="Vibration" />
      </Specimen>
      <Specimen title="Switch Row" testId="ui-switch-row">
        <SwitchRow
          className={WIDE}
          label="Single-Key Shortcuts"
          description="Press / to search and ? for the shortcut list."
          checked={singleKey}
          onCheckedChange={setSingleKey}
        />
      </Specimen>
      <Specimen title="Checkbox" testId="ui-checkbox">
        <Checkbox checked={selected} onCheckedChange={(v) => setSelected(v === true)} aria-label="Select this game" />
        <Checkbox checked disabled aria-label="Always included" />
      </Specimen>
      <Specimen title="Checkbox Row" testId="ui-checkbox-row" note="The first row is indeterminate while only some types are on.">
        <div className="flex w-full flex-col">
          <CheckboxRow
            label="All Mistake Types"
            checked={all}
            onCheckedChange={(v) => setTypes(v ? MISTAKE_TYPES.map((t) => t.id) : [])}
            data-testid="ui-checkbox-all"
          />
          <div className="flex flex-col pl-7">
            {MISTAKE_TYPES.map((t) => (
              <CheckboxRow
                key={t.id}
                label={t.label}
                checked={types.includes(t.id)}
                onCheckedChange={(v) => setTypes((cur) => (v ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
              />
            ))}
          </div>
        </div>
      </Specimen>
      <Specimen title="Radio Card" testId="ui-radio-card">
        <RadioCardGroup aria-label="Start from" value={startFrom} onValueChange={setStartFrom} className={WIDE}>
          <RadioCard value="standard" label="Standard Start" description="The usual opening position." />
          <RadioCard value="legend" label="Legend Position" description="A moment from a famous game." meta={<Tag>New</Tag>} />
          <RadioCard value="fen" label="Custom FEN" description="Paste any position." disabled />
        </RadioCardGroup>
      </Specimen>
      <Specimen title="Radio Card · Swatch" testId="ui-radio-swatch">
        <RadioCardGroup variant="swatch" aria-label="Board theme" value={theme} onValueChange={setTheme} className={WIDE}>
          <RadioCard value="walnut" label="Walnut" swatch={<BoardSwatch light="bg-board-light-center" dark="bg-board-dark-center" />} />
          <RadioCard value="paper" label="Paper" swatch={<BoardSwatch light="bg-article-board-light" dark="bg-article-board-dark" />} />
          <RadioCard value="ink" label="Ink" swatch={<BoardSwatch light="bg-cb-fill" dark="bg-cb-accent" />} />
        </RadioCardGroup>
      </Specimen>
    </div>
  );
}

function BoardSwatch({ light, dark }: { light: string; dark: string }) {
  return (
    <span className="grid size-full grid-cols-4 grid-rows-2">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={(Math.floor(i / 4) + i) % 2 === 0 ? light : dark} />
      ))}
    </span>
  );
}

function BannerSpecimens() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Specimen title="Banner · Info" testId="ui-banner-info">
        <Banner tone="info" className={WIDE}>
          Your import is running. We will tell you when it finishes.
        </Banner>
      </Specimen>
      <Specimen title="Banner · Good" testId="ui-banner-good">
        <Banner tone="good" className={WIDE}>
          Payment received. Your membership is active.
        </Banner>
      </Specimen>
      <Specimen title="Banner · Warn" testId="ui-banner-warn">
        <Banner
          tone="warn"
          className={WIDE}
          action={
            <Button size="sm" variant="secondary">
              Update Payment
            </Button>
          }
        >
          Your card expires this month.
        </Banner>
      </Specimen>
      <Specimen title="Banner · Bad" testId="ui-banner-bad">
        <Banner tone="bad" className={WIDE}>
          We couldn&apos;t charge your card. Your membership pauses in 3 days.
        </Banner>
      </Specimen>
      <Specimen title="Banner · Note" testId="ui-banner-note">
        <Banner tone="info" layout="note" title="How the trial works" className={WIDE}>
          Seven days with every feature. Cancel before the trial ends and you pay nothing. We remind you two days before.
        </Banner>
      </Specimen>
      <Specimen title="Banner · Dismiss" testId="ui-banner-dismiss">
        {dismissed ? (
          <Button variant="text" onClick={() => setDismissed(false)}>
            Show Banner Again
          </Button>
        ) : (
          <Banner tone="info" className={WIDE} onDismiss={() => setDismissed(true)}>
            New: review your games with the coach.
          </Banner>
        )}
      </Specimen>
    </div>
  );
}

function DisplaySpecimens() {
  return (
    <div className={GRID}>
      <Specimen title="Tag · Tones" testId="ui-tag-neutral">
        <Tag>Rapid</Tag>
        <span data-testid="ui-tag-good">
          <Tag tone="good" icon={<Check />}>
            Verified
          </Tag>
        </span>
        <span data-testid="ui-tag-warn">
          <Tag tone="warn">Low Time</Tag>
        </span>
        <span data-testid="ui-tag-bad">
          <Tag tone="bad">Blunder</Tag>
        </span>
        <span data-testid="ui-tag-ink">
          <Tag tone="ink">Live</Tag>
        </span>
      </Specimen>
      <Specimen title="Tag · Pill, Tint, Metric" testId="ui-tag-pill">
        <Tag size="md">Attack</Tag>
        <Tag size="md" tone="good">
          Won
        </Tag>
        <span data-testid="ui-tag-tint">
          <Tag tone="warn" variant="tint">
            Trial · 5 days left
          </Tag>
        </span>
        <span data-testid="ui-tag-metric">
          <Tag variant="metric">1520 Rapid</Tag>
        </span>
      </Specimen>
      <Specimen title="Card" testId="ui-card">
        <Card padding="none" className={WIDE} aria-labelledby="ui-card-title">
          <CardHeader id="ui-card-title" headingLevel={3} title="Recent Games" action={<Button variant="text" size="sm">See All</Button>} />
          <CardBody className="text-body text-cb-text-soft">Three games this week, two wins.</CardBody>
        </Card>
      </Specimen>
      <Specimen title="Card · Interactive" testId="ui-card-interactive">
        <Card asChild interactive padding="md" className="flex w-full flex-col gap-1.5">
          <Link href="/dev/ui#controls">
            <span className="text-overline">Openings</span>
            <span className="text-body text-cb-text">Sicilian Defence: Najdorf</span>
            <span className="text-ui text-cb-text-soft">The whole card is one link.</span>
          </Link>
        </Card>
      </Specimen>
      <Specimen title="Divider" testId="ui-divider">
        <div className="flex w-full flex-col gap-4">
          <Divider />
          <Divider label="or" />
        </div>
      </Specimen>
      <Specimen title="Overline" testId="ui-overline">
        <Overline as="h3">Legendary Positions</Overline>
      </Specimen>
      <Specimen title="Eyebrow" testId="ui-eyebrow" note="Marketing pages only.">
        <Eyebrow>Replay Chess</Eyebrow>
      </Specimen>
      <Specimen title="Disclosure" testId="ui-disclosure">
        <Disclosure summary="How Does the Trial Work?">
          You get seven days with every feature. We remind you two days before it ends.
        </Disclosure>
      </Specimen>
      <Specimen title="Page Header" testId="ui-page-header" className="lg:col-span-2">
        <PageHeader
          className="w-full px-0"
          headingLevel={2}
          overline="Train"
          title="Mistake Bank"
          info={<IconButton size="sm" variant="ghost" label="About the Mistake Bank" icon={<Info />} />}
          actions={
            <Button variant="secondary" iconStart={<SlidersHorizontal />}>
              Filters
            </Button>
          }
        />
      </Specimen>
    </div>
  );
}

function AvatarSpecimens() {
  return (
    <div className={GRID}>
      <Specimen title="Avatar · Sizes" testId="ui-avatar-sizes">
        <div className="flex items-end gap-3">
          {([28, 32, 36, 56, 72] as const).map((size) => (
            <Avatar key={size} name="Bobby Fischer" seed="user_fischer" size={size} />
          ))}
        </div>
        <span className="self-center text-body">Bobby Fischer</span>
      </Specimen>
      <Specimen title="Avatar · Variants" testId="ui-avatar-variants">
        {(
          [
            ["neutral", "knightowl_88"],
            ["ink", "Opponent"],
            ["gradient", "Judit Polgar"],
          ] as const
        ).map(([variant, name]) => (
          <span key={variant} className="inline-flex items-center gap-2">
            <Avatar name={name} variant={variant} size={36} />
            <span className="text-ui">{name}</span>
          </span>
        ))}
        {["user_1", "user_2", "user_3", "user_4", "user_5", "user_6"].map((seed) => (
          <Avatar key={seed} name="Magnus Carlsen" seed={seed} />
        ))}
      </Specimen>
      <Specimen title="Avatar · Image Fallback" testId="ui-avatar-image-fallback" note="A broken image falls back to initials.">
        <span className="inline-flex items-center gap-2">
          <Avatar name="Mikhail Tal" src="data:image/png;base64,broken" size={56} decorative={false} />
          <span className="text-body">Mikhail Tal</span>
        </span>
      </Specimen>
    </div>
  );
}

function LoadingSpecimens() {
  return (
    <div className={GRID}>
      <Specimen title="Skeleton · Text" testId="ui-skeleton-text">
        <div className="flex w-full flex-col gap-4">
          <Skeleton className="h-8 w-1/2" />
          <SkeletonText lines={3} />
        </div>
      </Specimen>
      <Specimen title="Skeleton · Row" testId="ui-skeleton-row">
        <div className="flex w-full flex-col divide-y divide-cb-border border border-cb-border">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </Specimen>
      <Specimen title="Skeleton · Region" testId="ui-skeleton-region" note="aria-busy with one hidden Loading… for screen readers.">
        <SkeletonRegion label="Loading game" className="flex w-full flex-col gap-3">
          <SkeletonPlayerBar />
          <Skeleton className="aspect-[4/1] w-full" />
          <SkeletonPlayerBar />
        </SkeletonRegion>
      </Specimen>
      <Specimen title="Progress" testId="ui-progress">
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <Overline>Importing Games</Overline>
            <span className="font-mono text-ui tabular-nums text-cb-text-soft">212 of 480 games</span>
          </div>
          <ProgressBar value={212} max={480} unit="games" label="Import progress" />
          <ProgressBar value={70} label="Analysis progress" size="thin" />
        </div>
      </Specimen>
      <Specimen title="Stacked Bar" testId="ui-stacked-bar">
        <div className="flex w-full flex-col gap-2">
          <StackedBar
            label="Results"
            segments={[
              { value: 54, tone: "good", label: "Wins" },
              { value: 12, tone: "neutral", label: "Draws" },
              { value: 34, tone: "bad", label: "Losses" },
            ]}
          />
          <span className="font-mono text-ui tabular-nums text-cb-text-soft">54 W · 12 D · 34 L</span>
        </div>
      </Specimen>
      <Specimen title="Action Bar" testId="ui-action-bar">
        <div className="flex w-full flex-col gap-3">
          <ActionBar
            direction="incoming"
            actions={
              <>
                <ActionBarButton>Decline</ActionBarButton>
                <ActionBarButton variant="primary">Accept Draw</ActionBarButton>
              </>
            }
          >
            Your opponent offers a draw.
          </ActionBar>
          <ActionBar direction="outgoing" actions={<ActionBarButton>Cancel Offer</ActionBarButton>}>
            Draw offer sent.
          </ActionBar>
        </div>
      </Specimen>
    </div>
  );
}

function EmptySpecimens() {
  return (
    <div className={GRID}>
      <Specimen title="Empty State · Page" testId="ui-empty-state-page">
        <EmptyState
          headingLevel={3}
          title="No Games Yet"
          body="Your games appear here after you play or import them."
          primary={
            <Button asChild>
              <Link href="/play">Play a Game</Link>
            </Button>
          }
        />
      </Specimen>
      <Specimen title="Empty State · Card" testId="ui-empty-state-card">
        <EmptyState
          size="card"
          headingLevel={3}
          icon={<Check />}
          title="All Caught Up"
          body="No positions are due today."
          primary={
            <Button variant="secondary" className="min-h-10 pointer-coarse:min-h-11 tap-target">
              Review Anyway
            </Button>
          }
        />
      </Specimen>
    </div>
  );
}
