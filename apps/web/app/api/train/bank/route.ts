// GET /api/train/bank (phase-05 plan §7.2 R2, §7.3): the Mistake Bank, keyset-paged. The first request (no cursor)
// answers `BankPage` with `meta {nextCursor, complete}` (a bank of ≤ 300 cards is complete: every row, filtered on the
// client); later pages answer `BankNextPage` with `meta {nextCursor}` only. A cursor minted for other filters is 400
// `validation_failed` (`cursor_filter_mismatch`). Reads only.
import { trainEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { listBank } from "@/lib/train/bank.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(trainEndpoints.bank, async (ctx) => {
  const { view, theme, phase, source, cursor } = ctx.query;
  const page = await listBank(ctx.viewer!, { view, theme, phase, source }, cursor ?? null, ctx.now);
  const meta = cursor ? { nextCursor: page.meta.nextCursor } : page.meta;
  // The page object and its meta travel in the standard envelope (`{data, meta}`); route() adds the headers.
  return new Response(JSON.stringify({ data: page.data, meta }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
});
