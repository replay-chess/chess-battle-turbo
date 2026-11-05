"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import {
  CreditCard,
  Download,
  FileText,
  LifeBuoy,
  LogOut,
  Moon,
  Shield,
  ShieldCheck,
  Sun,
  UserCog,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { usePWAInstall } from "@/lib/hooks/usePWAInstall";
import { membershipHref } from "@/lib/nav/destinations";
import { purgeRuntimeCaches } from "@/lib/shell/pwa";
import type { ShellUser } from "@/lib/shell/types";
import { trackShell, type AccountActionId } from "@/lib/analytics/shell-events";

export type AccountItem = {
  /** testid `account-item-<id>` */
  id: AccountActionId;
  /** Title Case. */
  label: string;
  icon: LucideIcon;
  /** A link item; otherwise `run` is called. */
  href?: string;
  external?: boolean;
  run?: () => void;
  /**
   * Link items: runs once the menu or sheet has fully closed (after Radix drops its scroll lock).
   * Membership uses it to scroll `#membership` into view when the link only changes the hash.
   */
  afterClose?: () => void;
  /** Run only after the menu or sheet has closed (it opens a modal). */
  deferred?: boolean;
  disabled?: boolean;
  /** Draw a separator above this item. */
  separatorBefore?: boolean;
};

type SignOutClient = { signOut: (options: { redirectUrl: string }) => Promise<unknown> };

/**
 * Sign Out lives in this one function so 1B·J can swap its body for
 * `signOutEverywhere()` (plan 13.2). The existing UserSync and PostHogIdentify
 * cleanup runs on sign-out; no second reset here.
 */
export async function runSignOut(clerk: SignOutClient): Promise<void> {
  await purgeRuntimeCaches();
  await clerk.signOut({ redirectUrl: "/" });
}

/**
 * Opens the Dodo customer portal in a new tab, then refreshes once when the tab
 * becomes visible again, so the entitlement shown isn't stale.
 */
export function openBillingPortal(refresh: () => void): void {
  window.open("/api/customer-portal", "_blank", "noopener");
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", onVisible);
    refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
}

/**
 * Scrolls the membership section into view when it is already on the page. A same-page hash link
 * fires while the menu's scroll lock is still on, so the browser's own hash scroll is lost. On
 * another page the element is absent and MembershipSection's mount effect does the scroll.
 */
function scrollToMembershipIfPresent(): void {
  const el = document.getElementById("membership");
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * One ordered list drives both the account Menu (sidebar/rail) and the account
 * Sheet (phone top bar). Labels are Title Case.
 */
export function useAccountActions(user: ShellUser, { demo = false }: { demo?: boolean } = {}) {
  const router = useRouter();
  const clerk = useClerk();
  // `useClerk().loaded` does not re-render when Clerk finishes loading; `useAuth().isLoaded` does.
  const { isLoaded: clerkLoaded } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const { canInstall, isInstalled, isIOS, install } = usePWAInstall();
  const [iosInstallOpen, setIosInstallOpen] = useState(false);

  const track = (action: AccountActionId) => trackShell({ name: "shell_account_action", action }, { demo });
  const dark = resolvedTheme === "dark";

  const items: AccountItem[] = [
    {
      id: "membership",
      label: "Membership",
      icon: CreditCard,
      href: membershipHref({ referenceId: user.referenceId }, demo),
      run: () => track("membership"),
      afterClose: demo ? undefined : scrollToMembershipIfPresent,
    },
  ];
  if (user.hasBillingPortal) {
    items.push({
      id: "billing",
      label: "Manage Billing",
      icon: WalletCards,
      run: () => {
        track("billing");
        if (!demo) openBillingPortal(() => router.refresh());
      },
    });
  }
  items.push(
    {
      id: "account",
      label: "Account",
      icon: UserCog,
      deferred: true,
      disabled: demo || !clerkLoaded,
      run: () => {
        track("account");
        clerk.openUserProfile();
      },
    },
    {
      id: "theme",
      label: dark ? "Switch to Light Theme" : "Switch to Dark Theme",
      icon: dark ? Sun : Moon,
      run: () => {
        track("theme");
        setTheme(dark ? "light" : "dark");
      },
    },
  );
  if (canInstall && !isInstalled) {
    items.push({
      id: "install",
      label: "Install App",
      icon: Download,
      deferred: true,
      run: () => {
        track("install");
        if (isIOS) setIosInstallOpen(true);
        else void install();
      },
    });
  }
  if (user.isAdmin) {
    items.push({ id: "admin", label: "Admin", icon: ShieldCheck, href: "/admin", run: () => track("admin") });
  }
  items.push(
    { id: "help", label: "Help", icon: LifeBuoy, href: "/help", separatorBefore: true, run: () => track("help") },
    { id: "privacy", label: "Privacy", icon: Shield, href: "/privacy", run: () => track("privacy") },
    { id: "terms", label: "Terms", icon: FileText, href: "/terms", run: () => track("terms") },
    {
      id: "signout",
      label: "Sign Out",
      icon: LogOut,
      separatorBefore: true,
      disabled: demo,
      run: () => {
        track("signout");
        void runSignOut(clerk);
      },
    },
  );

  return {
    items,
    iosInstall: { open: iosInstallOpen, onClose: () => setIosInstallOpen(false) },
  };
}
