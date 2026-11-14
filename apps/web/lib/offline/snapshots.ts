// Offline session snapshots (phase-05 plan §5.4 "Offline continuation", §2.2): the open runner mirrors its session
// payload to IndexedDB `rc-offline` under `u:<userRef>:session:<sessionRef>` when it loads (and after an extend), so
// P11's per-user service-worker cache can restore the runner after an offline reload. P5 itself never reads a
// snapshot to render: an online reload resumes from the server. Snapshots are per user, at most `SNAPSHOT_KEEP` per
// user (the newest), and cleared at sign-out with the outbox (cdl §6.6).
import type { SessionPayload } from "@repo/contracts/http/train";
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

export const OFFLINE_DB = "rc-offline";
export const OFFLINE_STORE = "items";
/** Session snapshots kept per user. */
export const SNAPSHOT_KEEP = 3;

export type SessionSnapshot = { v: 1; savedAt: number; payload: SessionPayload };

export function snapshotKey(userRef: string, sessionRef: string): string {
  return `u:${userRef}:session:${sessionRef}`;
}

export interface SnapshotStore {
  get(key: string): Promise<SessionSnapshot | undefined>;
  set(key: string, value: SessionSnapshot): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

let store: UseStore | null = null;
function idb(): UseStore {
  store ??= createStore(OFFLINE_DB, OFFLINE_STORE);
  return store;
}

export const idbSnapshotStore: SnapshotStore = {
  get: (k) => get<SessionSnapshot>(k, idb()),
  set: (k, v) => set(k, v, idb()),
  del: (k) => del(k, idb()),
  keys: async () => (await keys(idb())).map(String),
};

function available(s: SnapshotStore): boolean {
  return s !== idbSnapshotStore || typeof indexedDB !== "undefined";
}

/** Saves the payload; keeps the user's newest `SNAPSHOT_KEEP` snapshots. Never throws. */
export async function saveSessionSnapshot(
  userRef: string,
  payload: SessionPayload,
  opts: { now?: number; store?: SnapshotStore } = {},
): Promise<void> {
  const s = opts.store ?? idbSnapshotStore;
  if (!available(s)) return;
  try {
    await s.set(snapshotKey(userRef, payload.ref), { v: 1, savedAt: opts.now ?? Date.now(), payload });
    const prefix = `u:${userRef}:session:`;
    const mine = (await s.keys()).filter((k) => k.startsWith(prefix));
    if (mine.length <= SNAPSHOT_KEEP) return;
    const dated = await Promise.all(mine.map(async (k) => ({ k, at: (await s.get(k))?.savedAt ?? 0 })));
    dated.sort((a, b) => b.at - a.at);
    await Promise.all(dated.slice(SNAPSHOT_KEEP).map((d) => s.del(d.k)));
  } catch {
    // A snapshot is a convenience for P11; the session works without it.
  }
}

export async function loadSessionSnapshot(userRef: string, sessionRef: string, s: SnapshotStore = idbSnapshotStore): Promise<SessionPayload | null> {
  if (!available(s)) return null;
  try {
    const v = await s.get(snapshotKey(userRef, sessionRef));
    return v && v.v === 1 ? v.payload : null;
  } catch {
    return null;
  }
}

/** Sign-out: every snapshot of this user goes. */
export async function clearSessionSnapshots(userRef: string, s: SnapshotStore = idbSnapshotStore): Promise<void> {
  if (!available(s)) return;
  try {
    const prefix = `u:${userRef}:`;
    await Promise.all((await s.keys()).filter((k) => k.startsWith(prefix)).map((k) => s.del(k)));
  } catch {
    // best effort
  }
}

/** Sign-out where the tab does not know whose snapshots it holds (FIX-2): every snapshot of every member goes. */
export async function clearAllSnapshots(s: SnapshotStore = idbSnapshotStore): Promise<void> {
  if (!available(s)) return;
  try {
    await Promise.all((await s.keys()).filter((k) => k.startsWith("u:")).map((k) => s.del(k)));
  } catch {
    // best effort
  }
}
