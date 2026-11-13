import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { ConnectedDemo } from "@/components/accounts/ConnectedDemo";
import { ConnectedSkeleton } from "@/components/accounts/ConnectedSkeleton";
import { BOARD_STATES, isBoardState } from "@/components/accounts/model";
import { AppShellView } from "@/components/shell/AppShellView";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Connected Accounts Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/connected` (phase-04 plan §4.12): /settings/connected in each state of DR/V4SettingsConnected*, with no
 * server. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=default|syncing|sync_failed|rate_limited|not_found|private_games|li_connecting|li_denied|both_linked|none_linked
 *                     (no state: the index); state=loading renders the route's loading skeleton
 *   stress=1          20-character usernames and five-digit counts (the one-viewport check at 150 %)
 *   chrome=none       no app shell; chrome=marketing: the non-member page (legacy Navbar, document scroll)
 *   device=auto       accepted for the device suite; the viewport decides the layout
 */
export default async function ConnectedDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const stateParam = one(p.state);
  const stress = one(p.stress) === "1";
  const chromeParam = one(p.chrome);
  const state = isBoardState(stateParam) ? stateParam : null;
  if (!state && stateParam !== "loading") return <StateIndex />;
  const chrome = chromeParam === "marketing" ? "marketing" : "shell";
  // A new key per parameter set: client navigation between states rebuilds the demo's local state.
  const demo = state ? (
    <ConnectedDemo key={`${state}-${stress}-${chrome}`} state={state} stress={stress} chrome={chrome} />
  ) : (
    <ConnectedSkeleton chrome={chrome} profileHref="/dev/ui/connected" />
  );
  if (chrome === "marketing") return demo;
  if (chromeParam === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView user={stageUser({ payment: false, stress })} demo currentKey={null} navFlags={{ "review-v3": true }}>
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Connected Accounts Demo">
      <p className="mb-4 text-body text-cb-text-soft">
        /settings/connected (phase-04 plan §4.10) in each state of V4SettingsConnected and V4SettingsConnectedError, on
        fixtures.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="connected-demo-index">
        {[...BOARD_STATES, "loading"].map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/connected?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/connected?state=both_linked&stress=1" prefetch={false}>
            stress=1
          </Link>
        </li>
        <li>
          <Link className="font-mono text-label underline" href="/dev/ui/connected?state=none_linked&chrome=marketing" prefetch={false}>
            chrome=marketing
          </Link>
        </li>
      </ul>
    </GalleryFrame>
  );
}
