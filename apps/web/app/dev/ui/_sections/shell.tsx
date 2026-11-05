"use client";

import Link from "next/link";
import { CreditCard, FileText, LifeBuoy, LogOut, Moon, Shield, UserCog, WalletCards } from "lucide-react";
import { Sidebar } from "@/components/shell/Sidebar";
import { SubNav } from "@/components/shell/SubNav";
import { TabBar } from "@/components/shell/TabBar";
import { TopBar } from "@/components/shell/TopBar";
import { backFor, currentFromKey, subnavFor } from "@/lib/nav/destinations";
import { DEMO_USERS } from "../shell/demo-users";
import { GallerySection, Specimen } from "../_components/Specimen";

const member = DEMO_USERS.member;
const trial = DEMO_USERS.trial;
const me = { referenceId: member.referenceId };

const MENU_PREVIEW = [
  { label: "Membership", icon: CreditCard },
  { label: "Manage Billing", icon: WalletCards },
  { label: "Account", icon: UserCog },
  { label: "Switch to Dark Theme", icon: Moon },
  { label: "Help", icon: LifeBuoy, separatorBefore: true },
  { label: "Privacy", icon: Shield },
  { label: "Terms", icon: FileText },
  { label: "Sign Out", icon: LogOut, separatorBefore: true },
];

const LINK =
  "inline-flex min-h-11 items-center px-1 text-ui text-cb-text underline underline-offset-3 decoration-current/25 hover:decoration-current";

/**
 * Shell previews (SPEC 8.2 gallery). Static forms of each piece with demo
 * users and `#` hrefs. No ViewportStage here: it would lock gallery scroll.
 * Landmark labels are unique (axe landmark-unique).
 */
export function ShellSection() {
  const playCurrent = currentFromKey("play");
  const learnCurrent = currentFromKey("legends");

  return (
    <GallerySection id="shell" title="Shell">
      <div className="flex flex-wrap gap-2">
        <Link href="/dev/ui/shell" className={LINK}>
          Open Shell Demo
        </Link>
        <Link href="/dev/ui/shell?user=trial" className={LINK}>
          Open Trial Demo
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <Specimen
          title="Sidebar · 220"
          testId="ui-shell-sidebar"
          note="Play current; Tournaments always shows under Play."
        >
          <div className="h-[640px] w-[220px] overflow-hidden border border-cb-border">
            <Sidebar user={trial} current={playCurrent} preview variant="sidebar" previewLabel="Sidebar Preview" />
          </div>
        </Specimen>
        <Specimen
          title="Rail · 64"
          testId="ui-shell-rail"
          note="Labels stay as accessible names; tooltips on hover and focus."
        >
          <div className="h-[640px] w-16 overflow-hidden border border-cb-border">
            <Sidebar user={member} current={learnCurrent} preview variant="rail" previewLabel="Rail Preview" />
          </div>
        </Specimen>
      </div>

      <Specimen
        title="Top Bar · 393 × 44"
        testId="ui-shell-topbar"
        note="Default, then the Back form used on phone detail routes."
      >
        <div className="flex flex-col gap-3">
          <div className="h-11 w-[393px] max-w-full border border-cb-border">
            <TopBar user={member} back={null} preview />
          </div>
          <div className="h-11 w-[393px] max-w-full border border-cb-border">
            <TopBar user={member} back={backFor("legends", me)} preview />
          </div>
        </div>
      </Specimen>

      <Specimen title="Tab Bar · 393 × 56" testId="ui-shell-tabbar">
        <div className="h-14 w-[393px] max-w-full border border-cb-border">
          <TabBar me={me} current={playCurrent} preview previewLabel="Tab Bar Preview" />
        </div>
      </Specimen>

      <Specimen
        title="SubNav"
        testId="ui-shell-subnav"
        note="Shown in rail and tab-bar modes when the current destination has subs."
      >
        <div data-shell-form="rail" className="w-[393px] max-w-full border border-cb-border">
          <SubNav nav={subnavFor(playCurrent)} current={playCurrent} me={me} preview />
        </div>
      </Specimen>

      <Specimen title="Account Menu" testId="ui-shell-account-menu" note="Static preview of the open menu (member).">
        <div className="w-60 border border-cb-border-strong bg-cb-surface py-1 shadow-pop">
          <div className="flex flex-col gap-0.5 border-b border-cb-border px-3.5 pt-2 pb-2.5">
            <span className="text-ui font-medium text-cb-text">{member.name}</span>
            <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-cb-text-soft uppercase">
              {member.ratingLabel}
            </span>
          </div>
          <ul aria-label="Account Menu Preview">
            {MENU_PREVIEW.map(({ label, icon: Icon, separatorBefore }) => (
              <li
                key={label}
                className={
                  separatorBefore
                    ? "mt-1 flex min-h-11 items-center gap-2.5 border-t border-cb-border px-3.5 pt-1 text-sm text-cb-text"
                    : "flex min-h-11 items-center gap-2.5 px-3.5 text-sm text-cb-text"
                }
              >
                <Icon aria-hidden="true" size={16} className="text-cb-text-soft" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </Specimen>
    </GallerySection>
  );
}
