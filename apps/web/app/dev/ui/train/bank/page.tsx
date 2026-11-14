import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { BankDemo } from "@/components/train/bank/BankDemo";
import { BANK_DEMO_STATES, isStress, pickState } from "../../_fixtures/train";
import { GalleryFrame } from "../../_components/Specimen";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Mistake Bank Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = [...BANK_DEMO_STATES, "remove"] as const;

/**
 * `/dev/ui/train/bank` (phase-05 plan §2.1, §4.3): /train/bank in each state of DR/V3MistakeBank, V3BankEmpty,
 * V3BankCaughtUp, V3BankLoading and the iPhone, Android, iPad L and iPad P MistakeBank and Bank boards, from contract
 * fixtures, with no server. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=default|filtered|loading|empty|caughtup|cap_reached|due|remove   (no state: the index)
 *                     filtered = Theme Fork (the board's popover state); due = the Due tab (the device `due` boards);
 *                     remove = the `bank-remove` row menu with its Undo toast (D-2); loading = the route's skeleton
 *   open=1            the Filter surface open on load (popover on desktop, sheet in tab-bar mode)
 *   stress=1          300 rows with the longest names (a complete bank at its limit)
 *   chrome=none       no app shell
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function BankDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const raw = one(p.state);
  const stress = isStress(p);
  if (!raw && !stress) return <StateIndex />;
  const state = pickState(STATES, raw);
  const open = one(p.open) === "1";
  const demo = <BankDemo key={`${state}-${stress}-${open}`} state={state} stress={stress} routeSkeleton={one(p.route) === "1"} filterOpen={open} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey="train" navFlags={{ "review-v3": true, train: true, home: true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Mistake Bank Demo">
      <p className="mb-4 text-body text-cb-text-soft">/train/bank (phase-05 plan §4.3) in each design state, on contract fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="train-bank-demo-index">
        {STATES.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/train/bank?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/bank?state=filtered&open=1" prefetch={false}>
            filter open
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/train/bank?state=default&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
