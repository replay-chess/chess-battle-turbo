"use client";

// useOutboxSync (phase-05 plan §5.4 step 4): mounted once in the (app) layout for a signed-in viewer
// (`<OutboxSync userRef=… />`). It flushes graded attempts that are still on the device on app mount, when the
// connection returns (`online`), when the tab comes back into view, and with `keepalive` when the tab is hidden or the
// page goes away; and it listens for the other tabs' `rc-sync` stale messages (lib/offline/crossTab.ts).
//
// Cost on routes that never train: this module and crossTab only (no IndexedDB library). The outbox code loads on
// demand, when localStorage's hint says something is queued for this user or when a flush event fires with a queue;
// where localStorage is blocked it checks IndexedDB once on mount.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setOutboxUser } from "./active-user";
import { listenCrossTab } from "./crossTab";

/** localStorage hint written by the outbox (lib/offline/outbox.ts hintKey). */
function hintedPending(userRef: string): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return Number(localStorage.getItem(`rc.outbox.${userRef}`) ?? "0") > 0;
  } catch {
    return null;
  }
}

type Runtime = {
  flush: (opts?: { keepalive?: boolean }) => Promise<unknown>;
  uninstall: () => void;
};

export function useOutboxSync(userRef: string | null | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    // Whose stores these are now (null = signed out): another member's queue is never sent (FIX-1).
    setOutboxUser(userRef ?? null);
    if (!userRef) return;
    let runtime: Runtime | null = null;
    let loading: Promise<Runtime> | null = null;
    let disposed = false;

    const load = (): Promise<Runtime> => {
      loading ??= Promise.all([import("./attempts-sync"), import("./outbox")]).then(([sync, outbox]) => {
        sync.disposeOtherSchedulers(userRef);
        const uninstall = sync.installAttemptsSync(userRef, qc);
        const scheduler = sync.getAttemptsScheduler(userRef);
        const rt: Runtime = {
          flush: async (opts) => {
            const pending = await outbox.pendingAttempts(userRef);
            if (!pending.length) return;
            return scheduler.flush(opts);
          },
          uninstall,
        };
        if (disposed) uninstall();
        else runtime = rt;
        return rt;
      });
      return loading;
    };

    const flushIfQueued = (opts?: { keepalive?: boolean }) => {
      const hint = hintedPending(userRef);
      if (hint === false && !runtime) return;
      void load().then((rt) => (disposed ? undefined : rt.flush(opts)));
    };

    flushIfQueued();
    const onOnline = () => flushIfQueued();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushIfQueued({ keepalive: true });
      else flushIfQueued();
    };
    const onPageHide = () => flushIfQueued({ keepalive: true });
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const stopCrossTab = listenCrossTab(qc);
    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      stopCrossTab();
      runtime?.uninstall();
      runtime = null;
      // This member's timers stop with the layout (a re-auth as someone else mounts a new one): no retry of A's queue
      // fires later with B's cookie. Only when the outbox code was loaded at all.
      void loading?.then(() => import("./attempts-sync")).then((sync) => sync.disposeAttemptsScheduler(userRef));
    };
  }, [userRef, qc]);
}

/** The layout's one-line mount: `{viewer ? <OutboxSync userRef={viewer.ref} /> : null}`. Renders nothing. */
export function OutboxSync({ userRef }: { userRef: string }): null {
  useOutboxSync(userRef);
  return null;
}
