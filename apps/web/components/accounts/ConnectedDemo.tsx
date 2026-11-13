"use client";

// `/dev/ui/connected?state=…` (phase-04 plan §4.12): the real ConnectedPanel on fixtures, with no server. Each of the
// ten board states opens as the board draws it, and the board's flows run locally: Sync now / Try again (the import
// counts up, then "Sync finished · N new games"), Look up profile (`knightowl_88` links, anything else is
// `not_found`), Connect Lichess (waits, then links with a toast), the daily-import switch ("SAVED · SYNCED"), the
// rate-limit countdown and Disconnect (with the inline confirm).
import { useEffect, useRef, useState } from "react";
import type { LinkedAccountView } from "@repo/contracts/http/accounts";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import { notify } from "@/components/ui/toast";
import { disconnectedToast, lichessLinkedToast, syncFinishedToast } from "./copy";
import { ConnectedPanel, type PerProvider } from "./ConnectedPanel";
import { DEMO_CHESSCOM_USERNAME, demoChessCom, demoLichess, demoScene, demoSyncing } from "./demo";
import { SAVED_FLASH_MS, isSyncingView, panelModels, type BoardState } from "./model";
import { useNow } from "./useNow";

/** Games per second while a demo sync runs (the board: 212 → 480 at 34/s). */
export const DEMO_IMPORT_RATE = 34;
export const DEMO_LOOKUP_MS = 1_200;
export const DEMO_LICHESS_MS = 1_800;

export function ConnectedDemo({ state, stress, chrome }: { state: BoardState; stress: boolean; chrome: "shell" | "marketing" }) {
  const [t0] = useState(() => Date.now());
  const [scene] = useState(() => demoScene(state, t0, stress));
  const [accounts, setAccounts] = useState<PerProvider<LinkedAccountView | null>>({ chesscom: scene.chesscom, lichess: scene.lichess });
  const [ccInput, setCcInput] = useState(scene.ccInput);
  const [ccError, setCcError] = useState(scene.ccError);
  const [looking, setLooking] = useState(false);
  const [liConnecting, setLiConnecting] = useState(scene.liConnecting);
  const [liReturned, setLiReturned] = useState(scene.liReturned);
  const [liJustLinked, setLiJustLinked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<ProviderSlug | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Where each running demo import started, for "Sync finished · N new games".
  const syncStart = useRef<PerProvider<number>>({ chesscom: scene.chesscom?.run?.imported ?? 0, lichess: 0 });
  const noSync: PerProvider<boolean> = { chesscom: false, lichess: false };
  const noErr: PerProvider<null> = { chesscom: null, lichess: null };

  const cc = {
    input: ccInput,
    onInput: (v: string) => {
      setCcInput(v);
      setCcError(null);
    },
    onSubmit: () => {
      const typed = ccInput.trim().replace(/^@/, "");
      setLooking(true);
      setTimeout(() => {
        setLooking(false);
        if (typed.toLowerCase() === DEMO_CHESSCOM_USERNAME) {
          const now = Date.now();
          syncStart.current.chesscom = 0;
          setAccounts((a) => ({ ...a, chesscom: demoSyncing(demoChessCom(now, stress), now, 0, stress ? 12_480 : 480) }));
          setCcInput("");
          setSavedAt(now);
        } else {
          setCcError({ kind: "not_found", typed });
        }
      }, DEMO_LOOKUP_MS);
    },
    looking,
    error: ccError,
  };
  const li = {
    connecting: liConnecting,
    returned: liReturned,
    justLinked: liJustLinked,
    onConnect: () => {
      setLiReturned(null);
      setLiConnecting(true);
      setTimeout(() => {
        const account = demoLichess(Date.now(), stress);
        setLiConnecting(false);
        setLiJustLinked(true);
        setAccounts((a) => ({ ...a, lichess: account }));
        notify.success(lichessLinkedToast(account.importedCount));
      }, DEMO_LICHESS_MS);
    },
  };

  const preview = panelModels({ nowMs: t0, chesscom: accounts.chesscom, lichess: accounts.lichess, syncPending: noSync, cc, li });
  const fast =
    isSyncingView(preview.chesscom) ||
    isSyncingView(preview.lichess) ||
    [preview.chesscom, preview.lichess].some((c) => c.linked && c.view === "rate_limited") ||
    savedAt !== null;
  const now = useNow(t0, fast);

  // The running import counts up; at the total it finishes like import:finished would.
  useEffect(() => {
    for (const provider of ["chesscom", "lichess"] as const) {
      const a = accounts[provider];
      const run = a?.run;
      if (!a || a.status !== "syncing" || !run || run.total === null) continue;
      const started = Date.parse(run.updatedAt);
      const imported = Math.min(run.total, run.imported + Math.floor(((now - started) / 1000) * DEMO_IMPORT_RATE));
      if (imported >= run.total) {
        const newGames = run.total - syncStart.current[provider];
        setAccounts((prev) => ({
          ...prev,
          [provider]: {
            ...a,
            status: "linked",
            lastSyncAt: new Date(now).toISOString(),
            lastSyncOkAt: new Date(now).toISOString(),
            importedCount: run.total,
            run: { ...run, status: "done", imported: run.total, finishedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
          },
        }));
        notify.success(syncFinishedToast(Math.max(0, newGames)));
      } else if (imported !== run.imported) {
        setAccounts((prev) => ({ ...prev, [provider]: { ...a, run: { ...run, imported, updatedAt: new Date(now).toISOString() } } }));
      }
    }
  }, [now, accounts]);

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [savedAt]);

  const startSync = (provider: ProviderSlug) => {
    const a = accounts[provider];
    if (!a) return;
    const n = Date.now();
    syncStart.current[provider] = 212;
    setAccounts((prev) => ({ ...prev, [provider]: { ...demoSyncing(a, n, 212, a.importedCount || 480), lastError: null, nextAllowedSyncAt: null } }));
  };

  return (
    <ConnectedPanel
      nowMs={now}
      chesscom={accounts.chesscom}
      lichess={accounts.lichess}
      saved={savedAt !== null}
      profileHref="/dev/ui/connected"
      chrome={chrome}
      cc={cc}
      li={li}
      syncPending={noSync}
      syncError={noErr}
      onSync={startSync}
      onAutoImport={(provider, on) => {
        setAccounts((prev) => ({ ...prev, [provider]: prev[provider] ? { ...prev[provider], autoImport: on } : null }));
        setSavedAt(Date.now());
      }}
      confirmOpen={confirmOpen}
      onConfirmOpen={setConfirmOpen}
      disconnectPending={null}
      disconnectError={null}
      onDisconnect={(provider, deleteGames) => {
        setConfirmOpen(null);
        setAccounts((prev) => ({ ...prev, [provider]: null }));
        if (provider === "lichess") setLiJustLinked(false);
        notify.success(disconnectedToast(provider, deleteGames));
      }}
    />
  );
}
