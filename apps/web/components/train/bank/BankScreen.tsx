"use client";

// /train/bank wired (phase-05 plan §4.3 transitions, §5.1, §5.2 S3, §5.3). The RSC seeds the bank (page 1 of the whole
// bank, and for a large bank the URL's filter too), so the first paint makes no /api request. Then:
// - URL state `?view&theme&phase&source&sel` is written with `history.replaceState` (no RSC request, Back leaves the
//   page) and re-read on `popstate`;
// - a complete bank (≤ 300 rows, `meta.complete`) filters here, instantly; a larger one fetches the filter's pages
//   (`keepPreviousData`: old rows dim, a hairline after 200 ms; the next page when the sentinel nears the view);
//   `400 validation_failed {reason: cursor_filter_mismatch}` drops the cursor and refetches page 1;
// - push: `bank:due_changed`, `mistakes:added`, `analysis:done|batch` refetch the visible bank at most once per 30 s;
// - Review n Due / Drill These n: W2 `{kind: "bank", source: "bank", filter, practice}`, then the runner;
// - Remove From Bank (`bank-remove`): optimistic, Undo for 6 s, then `DELETE /api/train/cards/:ref`; a failure brings
//   the row back.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { BankRow } from "@repo/contracts/http/train";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { notify } from "@/components/ui/toast";
import { trackTrain } from "@/lib/analytics/train-events";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useMe } from "@/lib/api/queries/me";
import { bankQuery, bankRowsOf, firstBankPage, type BankListData } from "@/lib/api/queries/train";
import { useFlag } from "@/lib/flags/client";
import { BANK_LISTS_KEY, useTrainEvents } from "@/lib/realtime/handlers/train";
import { useStartSession } from "../hub/useStartSession";
import { dayWord, safeTimeZone, useClientNow } from "../hub/when";
import { BankSkeleton } from "./BankSkeleton";
import { BankView } from "./BankView";
import {
  BASE_BANK_FILTER,
  bankHref,
  bankSessionBody,
  bodyOf,
  parseBankSearch,
  serverFilterOf,
  solveHref,
  type BankUrlState,
} from "./model";

/** The Undo window of Remove From Bank (cdl §3.5; the undo toast's own duration). */
export const REMOVE_UNDO_MS = 6_000;

function cardPath(ref: string): string {
  return endpoints.trainCard.replace("{ref}", encodeURIComponent(ref));
}

export function BankScreen({ initial, serverNowMs }: { initial: BankUrlState; serverNowMs: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [url, setUrl] = useState<BankUrlState>(initial);
  const [filterOpen, setFilterOpen] = useState(false);
  const now = useClientNow(serverNowMs);
  const timeZone = useMe((m) => m.user.timeZone ?? null).data ?? null;
  const removeOn = useFlag("bank-remove");

  useTrainEvents();

  // URL → state on Back/Forward within the page's own history entries.
  useEffect(() => {
    const onPop = () => setUrl(parseBankSearch(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const write = useCallback((next: BankUrlState) => {
    setUrl(next);
    window.history.replaceState(null, "", bankHref(next));
  }, []);

  // The whole bank (page 1 says whether it is complete) and, for a large bank, the filter's own pages.
  const base = useInfiniteQuery(bankQuery(BASE_BANK_FILTER));
  // bankQuery's page param is `string | null`; the hook types it loosely.
  const baseData = base.data as BankListData | undefined;
  const page = firstBankPage(baseData);
  const complete = baseData?.pages[0]?.meta.complete === true;
  const active = useInfiniteQuery({ ...bankQuery(serverFilterOf(url)), enabled: Boolean(page) && !complete });
  const activeData = active.data as BankListData | undefined;

  // A cursor minted for another filter: start that list again from page 1.
  const activeError = active.error;
  useEffect(() => {
    if (isApiError(activeError) && activeError.code === "validation_failed" && activeError.reason === "cursor_filter_mismatch") {
      void qc.resetQueries({ queryKey: bankQuery(serverFilterOf(url)).queryKey, exact: true });
    }
  }, [activeError, qc, url]);

  // Remove From Bank: hidden at once, committed after the Undo window (or when the page goes away).
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRemovals = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const commitRemove = useCallback(
    (ref: string, keepalive = false) => {
      pendingRemovals.current.delete(ref);
      void api(cardPath(ref), { method: "DELETE", keepalive })
        .then(() => {
          for (const key of [qk.train.today(), BANK_LISTS_KEY, qk.home(), qk.badges(), qk.me()]) {
            void qc.invalidateQueries({ queryKey: key, refetchType: "none" });
          }
        })
        .catch(() => {
          setRemoved((prev) => {
            const next = new Set(prev);
            next.delete(ref);
            return next;
          });
          notify.error("Couldn’t remove that position.");
        });
    },
    [qc],
  );
  useEffect(() => {
    const pending = pendingRemovals.current;
    return () => {
      for (const [ref, timer] of pending) {
        clearTimeout(timer);
        commitRemove(ref, true);
      }
    };
  }, [commitRemove]);
  const remove = (row: BankRow) => {
    setRemoved((prev) => new Set(prev).add(row.cardRef));
    const timer = setTimeout(() => {
      trackTrain("bank_card_removed", { undo: false });
      commitRemove(row.cardRef);
    }, REMOVE_UNDO_MS);
    pendingRemovals.current.set(row.cardRef, timer);
    notify.undo("Removed from your Mistake Bank", {
      id: `bank-remove-${row.cardRef}`,
      onUndo: () => {
        clearTimeout(timer);
        pendingRemovals.current.delete(row.cardRef);
        trackTrain("bank_card_removed", { undo: true });
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(row.cardRef);
          return next;
        });
      },
    });
  };

  const start = useStartSession();
  const startLimit = useRetryCountdown(start, { routeId: "train.sessions.create" });

  // bank_viewed: once per mount, from the seeded page.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !page) return;
    viewed.current = true;
    trackTrain("bank_viewed", { state: page.state, due: page.counts.due, total: page.counts.all, complete });
  }, [page, complete]);

  if (!page) return <BankSkeleton />;

  const sourceRows = complete ? bankRowsOf(baseData) : bankRowsOf(activeData ?? baseData);
  const rows = removed.size ? sourceRows.filter((r) => !removed.has(r.cardRef)) : sourceRows;
  const tz = safeTimeZone(timeZone);
  const nextDay = page.nextBatch ? dayWord(page.nextBatch.at, now, tz) : null;
  const body = bodyOf(page, url);

  return (
    <BankView
      page={page}
      rows={rows}
      complete={complete}
      filter={url}
      sel={url.sel}
      nextDay={nextDay}
      onFilter={(next) => write({ ...next, sel: url.sel })}
      onSelect={(sel) => write({ ...url, sel })}
      onOpenRow={(row) => {
        trackTrain("bank_solve_one_clicked", { mastery: row.mastery });
        router.push(solveHref(row.cardRef));
      }}
      onStart={(cta) => start.mutate(bankSessionBody(url, cta))}
      starting={start.isPending || start.isSuccess}
      startLimit={startLimit}
      refreshing={!complete && active.isPlaceholderData}
      hasNext={body === "list" && !complete && Boolean(active.hasNextPage)}
      loadingNext={active.isFetchingNextPage}
      onLoadNext={() => void active.fetchNextPage()}
      filterOpen={filterOpen}
      onFilterOpenChange={setFilterOpen}
      onFilterShown={(results) =>
        trackTrain("bank_filter_applied", { theme: url.theme, phase: url.phase, source: url.source, results: results ?? rows.length })
      }
      removable={removeOn}
      onRemove={remove}
      onSolve={(row) => trackTrain("bank_solve_one_clicked", { mastery: row.mastery })}
      onSeeInGame={() => trackTrain("bank_see_in_game_clicked", {})}
    />
  );
}
