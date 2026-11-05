"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { BackTarget } from "@/lib/nav/destinations";
import { inAppNavCount } from "@/lib/shell/nav-history";
import type { ShellUser } from "@/lib/shell/types";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";

/**
 * Phone and iPad-portrait top bar (the ViewportStage CSS shows it in tab-bar
 * mode only). Detail routes swap the brand for Back.
 */
export function TopBar({
  user,
  back,
  demo = false,
  preview = false,
  onBack,
}: {
  user: ShellUser;
  back: BackTarget | null;
  demo?: boolean;
  /** Gallery previews: hrefs become hashes. */
  preview?: boolean;
  onBack?: () => void;
}) {
  const router = useRouter();

  return (
    <header
      data-testid="shell-topbar"
      className="flex h-full items-center gap-2 bg-cb-bg px-4 text-cb-text tablet-portrait:gap-2.5 tablet-portrait:border-b tablet-portrait:border-cb-border tablet-portrait:px-6"
    >
      {back ? (
        <Link
          href={preview ? `#${back.key}` : back.href}
          data-testid="shell-back"
          aria-label={`Back to ${back.label}`}
          className="-ml-2 inline-flex min-h-11 min-w-0 flex-1 items-center gap-1 px-2 text-ui font-medium focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]"
          onClick={(e) => {
            onBack?.();
            if (!preview && inAppNavCount() > 0) {
              e.preventDefault();
              router.back();
            }
          }}
        >
          <ChevronLeft aria-hidden="true" size={20} className="shrink-0" />
          <span className="truncate">{back.label}</span>
        </Link>
      ) : (
        <Brand
          href={preview ? "#play" : "/play"}
          className="flex-1 gap-2 tablet-portrait:gap-2.5"
          logoClassName="size-7 tablet-portrait:size-[30px]"
          wordmarkClassName="flex-1"
        />
      )}
      <AccountMenu
        user={user}
        demo={demo || preview}
        variant="sheet"
        trigger={
          <button
            type="button"
            data-testid="shell-account-avatar"
            className="tap-target inline-flex size-8 shrink-0 items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent]"
          >
            {/* Named by text, not aria-label: the initials are visible, so axe label-content-name-mismatch would flag a label. */}
            <span className="sr-only">Account Menu</span>
            <Avatar name={user.name} src={user.avatarUrl} size={32} variant="neutral" />
          </button>
        }
      />
    </header>
  );
}
