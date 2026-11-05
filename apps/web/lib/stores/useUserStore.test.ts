// The real store against an in-memory localStorage: a Phase 0 snapshot (persist version 0) is migrated on load,
// and what is written back is version 2 without `subscription` (plan §3.2, 1B·F4d acceptance).
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const KEY = "chess-user-store";
const memory = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
};

const V1_SNAPSHOT = {
  state: {
    user: {
      referenceId: "usr_ref_1",
      code: "ABC123",
      email: "ada@example.test",
      name: "Ada",
      profilePictureUrl: null,
      onboarded: true,
      role: "USER",
      clerkUserId: "user_clerk_1",
      stats: null,
      chessComProfile: null,
    },
    subscription: { plan: null, entitled: false },
    lastSyncedAt: 1_700_000_000_000,
  },
  version: 0,
};

type StoreModule = typeof import("./useUserStore");
let mod: StoreModule;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage, configurable: true, writable: true });
  memory.set(KEY, JSON.stringify(V1_SNAPSHOT));
  mod = await import("./useUserStore");
});

describe("useUserStore persistence (v1 → v2)", () => {
  it("loads the old user and drops the old subscription", () => {
    const state = mod.useUserStore.getState();
    assert.equal(state.user?.referenceId, "usr_ref_1");
    assert.equal(state.user?.clerkUserId, "user_clerk_1");
    assert.equal(state.subscription, null, "a persisted entitled:false must not reach the gate");
    assert.equal(state.lastSyncedAt, 1_700_000_000_000);
  });

  it("writes back version 2 with no subscription", () => {
    mod.useUserStore.getState().setSubscription({ plan: "player", entitled: true });
    const stored = JSON.parse(memory.get(KEY) ?? "{}") as { version: number; state: Record<string, unknown> };
    assert.equal(stored.version, 2);
    assert.deepEqual(Object.keys(stored.state).sort(), ["lastSyncedAt", "user"]);
  });

  it("clearStore empties memory and storage", () => {
    mod.useUserStore.getState().clearStore();
    const state = mod.useUserStore.getState();
    assert.equal(state.user, null);
    assert.equal(state.subscription, null);
  });

  it("no longer has fetchUserByEmail", () => {
    assert.equal("fetchUserByEmail" in mod.useUserStore.getState(), false);
  });
});
