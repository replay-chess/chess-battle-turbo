"use client";

// SessionExpiredModal (plan §4.9; V3SessionExpired `modal` → `signing_in`): the blocking "You’ve Been Signed Out"
// dialog. A centred 440 px dialog on desktop and tablets in landscape; the same content as a bottom sheet in tab-bar
// mode (phones, iPad portrait), chosen when it opens and held while it stays open (as ResponsiveDialog does).
//
// It cannot be dismissed: no close button, Esc and outside clicks are prevented. The only ways out are
// "Sign In Again" (→ /sign-in?redirect_url=<path+query>) and "Use a Different Account" (signOutEverywhere() →
// /sign-in?redirect_url=/play). A sign-in in another tab closes it (SessionWatcher).
//
// Built on the Radix Dialog primitives with the kit's dialog and sheet styles, because the kit's ResponsiveDialog
// has no `hideClose` / non-dismissable mode yet (request to 1A·P2 in the F8 hand-back). Focus starts on
// "Sign In Again"; Radix traps Tab and makes the background inert.
import { useRef, useState, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { TABBAR_MQ } from "@/lib/layout/media-queries";
import { trackSystem } from "@/lib/analytics/system-events";
import { signOutEverywhere, type SignOutClerk } from "@/lib/auth/sign-out";
import { cn } from "@/lib/utils";
import {
  DIFFERENT_ACCOUNT_RETURN,
  runBeforeSignIn,
  sessionExpiredStore,
  signInHref,
} from "./session-guard";

export const SESSION_MODAL_COPY = {
  title: "You’ve Been Signed Out",
  body: "Your session expired. Sign in to continue where you left off; you’ll come back to this page.",
  signIn: "Sign In Again",
  signingIn: "Opening Sign-In…",
  differentAccount: "Use a Different Account",
} as const;

export type SessionExpiredModalProps = {
  /** Clerk (useClerk()), for "Use a Different Account". */
  clerk?: SignOutClerk | null;
  queryClient?: QueryClient;
  /** Navigation seam for tests; default `location.assign`. */
  navigate?: (href: string) => void;
};

const OVERLAY =
  "fixed inset-0 z-(--cb-z-dialog) bg-cb-scrim-modal data-[state=open]:animate-rc-fade motion-reduce:animate-none";

const DIALOG_BOX =
  "fixed left-1/2 top-1/2 z-(--cb-z-dialog) flex max-h-[calc(100dvh-48px)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-none border border-cb-border-strong bg-cb-surface p-7 text-cb-text shadow-modal outline-none data-[state=open]:animate-rc-pop motion-reduce:data-[state=open]:animate-rc-fade";

const SHEET_BOX =
  "fixed inset-x-0 bottom-0 z-(--cb-z-dialog) flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-none border-t border-cb-border bg-cb-surface px-5 pt-2 pb-[calc(var(--safe-bottom,0px)+20px)] text-cb-text outline-none data-[state=open]:animate-rc-sheet motion-reduce:data-[state=open]:animate-rc-fade";

const defaultNavigate = (href: string) => {
  if (typeof window !== "undefined") window.location.assign(href);
};

export function SessionExpiredModal({ clerk, queryClient, navigate = defaultNavigate }: SessionExpiredModalProps) {
  const state = useSyncExternalStore(sessionExpiredStore.subscribe, sessionExpiredStore.get, sessionExpiredStore.getServer);
  const tabbar = useMediaQuery(TABBAR_MQ);
  // Follows the media query while closed and freezes while open (state adjusted during render).
  const [asSheet, setAsSheet] = useState(tabbar);
  if (!state.open && asSheet !== tabbar) setAsSheet(tabbar);

  const [switching, setSwitching] = useState(false);
  const signInRef = useRef<HTMLButtonElement>(null);
  const signingIn = state.phase === "signing_in";
  const busy = signingIn || switching;

  const signIn = () => {
    if (busy) return;
    sessionExpiredStore.setPhase("signing_in");
    trackSystem("session_expired_action", { action: "sign_in" });
    runBeforeSignIn();
    navigate(signInHref(state.returnPath));
  };

  const differentAccount = async () => {
    if (busy) return;
    setSwitching(true);
    trackSystem("session_expired_action", { action: "different_account" });
    const redirectUrl = signInHref(DIFFERENT_ACCOUNT_RETURN);
    try {
      if (clerk) await signOutEverywhere(clerk, { queryClient, redirectUrl });
      else navigate(redirectUrl);
    } catch {
      navigate(redirectUrl);
    }
  };

  const block = (e: Event) => e.preventDefault();

  return (
    <DialogPrimitive.Root open={state.open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(OVERLAY, asSheet && "bg-cb-scrim")} />
        <DialogPrimitive.Content
          aria-modal="true"
          data-testid="session-expired-modal"
          data-surface={asSheet ? "sheet" : "dialog"}
          data-state-name={state.phase}
          className={asSheet ? SHEET_BOX : DIALOG_BOX}
          onEscapeKeyDown={block}
          onInteractOutside={block}
          onPointerDownOutside={block}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            signInRef.current?.focus();
          }}
        >
          {asSheet ? (
            <span
              aria-hidden="true"
              data-rc-grabber
              className="mx-auto block h-1 w-9 shrink-0 rounded-full bg-cb-border-strong"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-cb-fill text-cb-text"
          >
            <Lock className="size-5" />
          </span>
          <DialogPrimitive.Title className="font-serif text-heading font-normal text-balance">
            {SESSION_MODAL_COPY.title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="m-0 text-body text-cb-text-soft text-pretty">
            {SESSION_MODAL_COPY.body}
          </DialogPrimitive.Description>
          <p className="m-0 font-mono text-ui break-all text-cb-text-soft" data-testid="session-expired-return">
            Returns to {state.returnPath}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              ref={signInRef}
              block
              loading={signingIn}
              loadingLabel={SESSION_MODAL_COPY.signingIn}
              onClick={signIn}
              data-testid="session-expired-sign-in"
            >
              {SESSION_MODAL_COPY.signIn}
            </Button>
            <Button
              variant="text"
              className="min-h-11 self-center"
              onClick={() => void differentAccount()}
              aria-disabled={busy || undefined}
              data-testid="session-expired-different-account"
            >
              {SESSION_MODAL_COPY.differentAccount}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
