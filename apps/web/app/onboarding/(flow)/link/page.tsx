// /onboarding/link (phase-04 plan §4.2). Server: the guard and the card's first state.
//   - a Confirm return (`?error=not_found&u=…`, `?error=linked_elsewhere`) → that state, the handle in the input;
//   - an existing Chess.com link → `found`, prefilled (Continue goes to its confirm page);
//   - a Lichess return (`?lichess=denied`, `?lichess=error&reason=…`) → the Lichess card's message.
import { LinkStep } from "@/components/onboarding/LinkStep";
import { loadStepPage } from "@/lib/data/onboarding";
import { lichessStateOf, normaliseTyped, stateFromConfirmReturn, type ChessComCardState } from "@/lib/onboarding/link-state";
import { suggestBand } from "@/lib/onboarding/suggest-band";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LinkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { state } = await loadStepPage("link", sp);
  const u = one(sp.u);
  const fromConfirm = stateFromConfirmReturn(one(sp.error), u ? normaliseTyped(u).slice(0, 25) : undefined);

  let initialUsername = "";
  let initialState: ChessComCardState = { kind: "default" };
  if (fromConfirm) {
    initialState = fromConfirm;
    initialUsername = fromConfirm.kind === "not_found" ? fromConfirm.typed : "";
  } else {
    const linked = state.accounts.find((a) => a.provider === "CHESSCOM" && a.status === "ACTIVE");
    if (linked) {
      const s = suggestBand(linked.ratings, "chesscom");
      initialUsername = linked.username;
      initialState = {
        kind: "found",
        found: {
          username: linked.username.toLowerCase(),
          displayUsername: linked.username,
          headline: s ? { timeClass: s.timeClass, rating: s.displayRating } : null,
          totalRatedGames: linked.totalRatedGames ?? 0,
        },
      };
    }
  }

  const retry = one(sp.retry) === "1";
  return (
    <LinkStep
      initialUsername={retry ? "" : initialUsername}
      initialState={retry ? { kind: "default" } : initialState}
      lichess={lichessStateOf(one(sp.lichess), one(sp.reason))}
      focusInput={retry || initialState.kind === "not_found"}
    />
  );
}
