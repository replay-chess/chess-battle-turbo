"use client";

// The /settings/connected page frame (phase-04 plan §4.10 layout, D4-17: a standalone page until P10's settings
// shell). Inside the app shell it is a one-viewport page (lock mode): the header, then one 760 px panel whose body
// is the only scroller. Desktop / iPad L: overline "Settings" + the serif h1 (the board's "Settings" h1 and panel h2
// collapse into one header until P10 adds the section list). iPad P / phones (tab-bar mode): the shell's top bar
// shows Back (to the own profile until P10) and the title; the h1 stays for screen readers; the cards sit on the
// page background like the `on_connected` pane of the device boards. Non-members (marketing chrome) get the legacy
// Navbar and a scrolling page.
import dynamic from "next/dynamic";
import Link from "next/link";
import { Check, UserRound } from "lucide-react";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { ShellBackOverride } from "@/components/shell/back-override";
import { useChrome } from "@/components/shell/chrome-context";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTRO, SAVED_STATUS } from "./copy";

// Marketing chrome only (signed-in non-members): kept out of the shell route's first-load JS.
const Navbar = dynamic(() => import("@/app/components/Navbar").then((m) => m.Navbar));

export const CONNECTED_TITLE = "Connected accounts";
const HEADING_ID = "settings-connected-h";

export function ConnectedFrame({
  saved,
  profileHref,
  boardState,
  children,
  chrome: chromeOverride,
}: {
  /** "SAVED · SYNCED" for 2.6 s after a settings write. */
  saved: boolean;
  /** The own profile (the phone Back target and "Your profile"); null while unknown. */
  profileHref: string | null;
  /** `data-state` for specs and the state-coverage check. */
  boardState?: string;
  children: React.ReactNode;
  /** Demo routes force a chrome. */
  chrome?: "shell" | "marketing";
}) {
  const ctxChrome = useChrome();
  const chrome = chromeOverride ?? ctxChrome;
  const savedChip = (className: string) => (
    <span role="status" className={cn("inline-flex min-h-6 items-center", className)} data-testid="settings-connected-saved">
      {saved ? (
        <span className="inline-flex animate-rc-fade items-center gap-1.5 font-mono text-label tracking-label text-cb-good motion-reduce:animate-none">
          <Check aria-hidden="true" className="size-3.5" />
          {SAVED_STATUS}
        </span>
      ) : null}
    </span>
  );

  const header = (
    <header className="flex items-end gap-4 tabbar:sr-only">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-overline">Settings</p>
        <h1 id={HEADING_ID} className="m-0 font-serif text-title font-normal text-cb-text">
          {CONNECTED_TITLE}
        </h1>
      </div>
      {savedChip("tabbar:hidden")}
      {profileHref ? (
        <Link
          href={profileHref}
          className={cn(buttonVariants({ variant: "text" }), "shrink-0 tabbar:hidden")}
          data-testid="settings-connected-profile"
        >
          <UserRound aria-hidden="true" />
          Your profile
        </Link>
      ) : null}
    </header>
  );

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="mt-2 mb-3.5 text-sm text-cb-text-soft vh700:hidden tabbar:mt-1">{INTRO}</p>
        {savedChip("hidden shrink-0 pt-2 tabbar:inline-flex")}
      </div>
      <div className="flex flex-col gap-3.5" data-testid="settings-connected-cards">
        {children}
      </div>
    </>
  );

  if (chrome === "marketing") {
    return (
      <div className="min-h-dvh bg-cb-bg text-cb-text" data-testid="settings-connected" data-state={boardState}>
        <Navbar />
        <main className="mx-auto flex w-full max-w-[824px] flex-col gap-5 px-8 pt-28 pb-16 tabbar:px-4 tabbar:pt-24">
          {header}
          <section aria-labelledby={HEADING_ID} className="border border-cb-border bg-cb-surface px-6 pt-2 pb-5 tabbar:border-0 tabbar:bg-transparent tabbar:px-0">
            {body}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      data-rc-lock=""
      data-testid="settings-connected"
      data-state={boardState}
      className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col gap-5 px-8 pt-7 pb-6 narrow:px-6 vh700:gap-3 vh700:pt-4 vh700:pb-3.5 tabbar:gap-0 tabbar:p-0"
    >
      {profileHref ? <ShellBackOverride target={{ key: "profile", href: profileHref, label: "Profile" }} /> : null}
      <TopBarTitle>
        <span className="truncate">{CONNECTED_TITLE}</span>
      </TopBarTitle>
      {header}
      <div className="flex max-h-full min-h-0 w-full max-w-[760px] flex-col self-start border border-cb-border bg-cb-surface tabbar:h-full tabbar:max-w-none tabbar:border-0 tabbar:bg-transparent">
        <ScrollRegion label={CONNECTED_TITLE} className="flex-1 px-6 pt-2 pb-5 narrow:px-[18px] tabbar:px-4 tabbar:pt-1 tabbar:pb-4">
          {body}
        </ScrollRegion>
      </div>
    </div>
  );
}
