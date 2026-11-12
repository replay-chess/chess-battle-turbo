"use client";

import Link from "next/link";
import { Search, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { RAIL_MQ } from "@/lib/layout/media-queries";
import {
  childrenOf,
  destination,
  destinationHref,
  topLevelDestinations,
  trialLabel,
  type Destination,
  type NavFlags,
} from "@/lib/nav/destinations";
import type { DestinationKey, ShellUser } from "@/lib/shell/types";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";

const ITEM =
  "flex min-h-11 items-center gap-3 px-3 text-sm text-cb-text-soft hover:bg-cb-fill hover:text-cb-text aria-[current=page]:bg-cb-accent aria-[current=page]:font-medium aria-[current=page]:text-cb-accent-fg forced-colors:aria-[current=page]:outline forced-colors:aria-[current=page]:outline-2 focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] active:bg-cb-fill rail:justify-center rail:px-0 rail:pointer-coarse:min-h-12";

const SUB =
  "flex min-h-9 tap-target items-center text-ui text-cb-text-soft hover:text-cb-text aria-[current=page]:font-medium aria-[current=page]:text-cb-text pointer-coarse:min-h-11 focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]";

export type SidebarProps = {
  user: ShellUser;
  current: Set<DestinationKey>;
  /** Flag-gated destinations (P3: Review). */
  navFlags?: NavFlags;
  demo?: boolean;
  /** Gallery previews: every href becomes `#<key>`. */
  preview?: boolean;
  /** Forces the form in gallery previews (sets data-shell-form). Default auto. */
  variant?: "auto" | "sidebar" | "rail";
  /** Replaces the landmark label in gallery previews (axe landmark-unique). */
  previewLabel?: string;
  onSearch?: () => void;
  onNavigate?: (key: DestinationKey) => void;
};

/** Sidebar (220px) or icon rail (64px); the `rail:` variant switches the form in CSS. */
export function Sidebar({
  user,
  current,
  navFlags,
  demo = false,
  preview = false,
  variant = "auto",
  previewLabel,
  onSearch,
  onNavigate,
}: SidebarProps) {
  const railMq = useMediaQuery(RAIL_MQ);
  const isRail = variant === "rail" || (variant === "auto" && railMq);
  const me = { referenceId: user.referenceId };
  const href = (d: Destination) => destinationHref(d, me, { demo, preview });
  const profileCurrent = current.has("profile");

  const subs = (parent: DestinationKey) => {
    const list = childrenOf(parent, navFlags);
    if (!list.length) return null;
    return (
      <div className="flex flex-col pt-0.5 pb-1 pl-[42px] rail:hidden vh640:hidden">
        {list.map((d) => (
          <Link
            key={d.key}
            href={href(d)}
            data-testid={`nav-item-${d.key}`}
            aria-current={current.has(d.key) ? "page" : undefined}
            className={SUB}
            onClick={() => onNavigate?.(d.key)}
          >
            {d.label}
          </Link>
        ))}
      </div>
    );
  };

  return (
    <nav
      aria-label={previewLabel ?? "Main navigation"}
      data-testid="shell-sidebar"
      data-shell-form={variant === "auto" ? undefined : variant}
      className="flex h-full flex-col gap-4 border-r border-cb-border bg-cb-bg px-3 py-4 text-cb-text rail:px-2 rail:py-3"
    >
      <div className="flex items-center justify-between gap-2 rail:flex-col rail:justify-center">
        <Brand
          href={preview ? "#play" : "/play"}
          wordmarkClassName="rail:hidden"
          // min-w-0 lets the wordmark truncate in the sidebar; the rail keeps the 44px hit box.
          className="min-w-0 rail:min-w-11 rail:justify-center"
          onNavigate={() => onNavigate?.("play")}
        />
        <IconButton
          variant="outline"
          label="Search (press /)"
          icon={<Search />}
          data-testid="shell-search-button"
          className="text-cb-text-soft vh640:hidden pointer-coarse:hidden"
          onClick={onSearch}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        {topLevelDestinations(navFlags).map((d) => {
          const Icon = d.icon;
          const isCurrent = current.has(d.key);
          const showSubs = d.key === "play" || (d.key === "learn" && isCurrent);
          return (
            <div key={d.key} className="flex flex-col">
              <Tooltip content={d.label} side="right" disabled={!isRail}>
                <Link
                  href={href(d)}
                  data-testid={`nav-item-${d.key}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={ITEM}
                  onClick={() => onNavigate?.(d.key)}
                >
                  {Icon ? (
                    <Icon
                      aria-hidden="true"
                      size={18}
                      strokeWidth={1.75}
                      className="shrink-0 rail:pointer-coarse:size-5"
                    />
                  ) : null}
                  <span className="rail:sr-only">{d.label}</span>
                </Link>
              </Tooltip>
              {showSubs ? subs(d.key) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-cb-border pt-3 rail:flex-col">
        <Link
          href={href(destination("profile"))}
          data-testid="shell-me-link"
          aria-current={profileCurrent ? "page" : undefined}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-1.5 hover:bg-cb-fill focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] rail:w-full rail:flex-none rail:justify-center rail:p-0"
          onClick={() => onNavigate?.("profile")}
        >
          <Avatar name={user.name} src={user.avatarUrl} size={32} variant="gradient" seed={user.referenceId} />
          <span className="hidden rail:inline sr-only">{user.name}</span>
          <span className="flex min-w-0 flex-col rail:hidden">
            <span className="truncate text-ui text-cb-text">{user.name}</span>
            {user.ratingLabel ? (
              <span
                data-testid="shell-rating"
                className="font-mono text-[0.6875rem] tracking-[0.08em] text-cb-text-soft uppercase"
              >
                {user.ratingLabel}
              </span>
            ) : null}
            {user.trialDaysLeft != null ? (
              <Tag
                data-testid="shell-trial-tag"
                tone="warn"
                variant="tint"
                className="mt-0.5 max-w-full self-start whitespace-normal"
              >
                {trialLabel(user.trialDaysLeft)}
              </Tag>
            ) : null}
          </span>
        </Link>
        <AccountMenu
          user={user}
          demo={demo || preview}
          variant="menu"
          trigger={
            <IconButton
              variant="outline"
              label="Account Menu"
              icon={<Settings strokeWidth={1.75} />}
              data-testid="shell-account-button"
              className="text-cb-text-soft [&_svg]:size-[18px]"
            />
          }
        />
      </div>
    </nav>
  );
}
