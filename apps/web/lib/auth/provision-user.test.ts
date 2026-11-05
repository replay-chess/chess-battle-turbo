// Plan §12.1 lib/auth/provision-user.test.ts: with a fake store and a fake Clerk user. Unverified primary → no relink,
// no create; verified → relink by email; P2002 race → re-read; code retry; existing googleId → no Clerk call.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClerkUserPayload, ClerkUserRow, ClerkUserStore, NewUserInput } from "@/lib/webhooks/clerk-events";
import { provisionUser, toClerkPayload, type ProvisionDeps } from "./provision-user";

function p2002(target: string): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: [target] } });
}

function fakeStore(rows: ClerkUserRow[] = []) {
  const log = { creates: 0, updates: [] as { id: bigint; data: unknown }[], warnings: [] as string[], createErrors: [] as Error[] };
  let nextId = 100n;
  const store: ClerkUserStore = {
    findByGoogleId: async (googleId) => rows.find((r) => r.googleId === googleId) ?? null,
    findByEmail: async (email) => rows.find((r) => r.email === email) ?? null,
    async create(input: NewUserInput, code: string) {
      log.creates += 1;
      const err = log.createErrors.shift();
      if (err) throw err;
      assert.match(code, /^[A-Z0-9]{6}$/);
      const row: ClerkUserRow = { id: nextId++, referenceId: `cref${nextId}`, ...input, isActive: true };
      rows.push(row);
      return row;
    },
    async update(id, data) {
      log.updates.push({ id, data });
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, data);
    },
    deactivate: async () => null,
    warn: (message) => {
      log.warnings.push(message);
    },
  };
  return { store, log, rows };
}

function clerkUser(status: "verified" | "unverified", email = "New@Example.test"): ClerkUserPayload {
  return {
    id: "user_new",
    email_addresses: [
      { id: "em_2", email_address: "other@example.test", verification: { status: "verified" } },
      { id: "em_1", email_address: email, verification: { status } },
    ],
    primary_email_address_id: "em_1",
    first_name: "New",
    last_name: "Player",
    image_url: "https://img.example/u.png",
  };
}

function deps(store: ClerkUserStore, clerk: ClerkUserPayload | null | Error, calls = { clerk: 0 }): ProvisionDeps {
  return {
    store,
    findByGoogleId: (id) => store.findByGoogleId(id),
    async loadClerkUser() {
      calls.clerk += 1;
      if (clerk instanceof Error) throw clerk;
      return clerk;
    },
  };
}

const existingRow = (overrides: Partial<ClerkUserRow> = {}): ClerkUserRow => ({
  id: 1n,
  referenceId: "cref1",
  googleId: "user_old",
  email: "new@example.test",
  name: "Old",
  profilePictureUrl: null,
  isActive: true,
  ...overrides,
});

describe("provisionUser (plan §8.5)", () => {
  it("an existing googleId returns the row without calling Clerk", async () => {
    const { store, log } = fakeStore([existingRow({ googleId: "user_new" })]);
    const calls = { clerk: 0 };
    assert.deepEqual(await provisionUser("user_new", deps(store, clerkUser("verified"), calls)), {
      status: "ok",
      userId: 1n,
      userRef: "cref1",
      created: false,
      relinked: false,
    });
    assert.equal(calls.clerk, 0);
    assert.equal(log.creates, 0);
  });

  it("an unverified primary email: no relink, no create", async () => {
    const { store, log } = fakeStore([existingRow()]);
    assert.deepEqual(await provisionUser("user_new", deps(store, clerkUser("unverified"))), { status: "unverified_email" });
    assert.equal(log.creates, 0);
    assert.equal(log.updates.length, 0);
  });

  it("a verified primary email matching another row relinks it (and re-activates it)", async () => {
    const { store, log } = fakeStore([existingRow({ isActive: false })]);
    const result = await provisionUser("user_new", deps(store, clerkUser("verified")));
    assert.deepEqual(result, { status: "ok", userId: 1n, userRef: "cref1", created: false, relinked: true });
    assert.deepEqual(log.updates, [{ id: 1n, data: { googleId: "user_new", isActive: true } }]);
    assert.equal(log.creates, 0);
    assert.ok(log.warnings.includes("user.relinked"));
  });

  it("a new verified user is created once with a normalised email", async () => {
    const { store, log, rows } = fakeStore();
    const result = await provisionUser("user_new", deps(store, clerkUser("verified")));
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.created, true);
    assert.equal(log.creates, 1);
    assert.equal(rows[0]?.email, "new@example.test");
    assert.equal(rows[0]?.name, "New Player");
  });

  it("a code collision retries with a new code", async () => {
    const { store, log } = fakeStore();
    log.createErrors.push(p2002("code"), p2002("code"));
    const result = await provisionUser("user_new", deps(store, clerkUser("verified")));
    assert.equal(result.status, "ok");
    assert.equal(log.creates, 3);
  });

  it("a P2002 race on googleId (the webhook won) re-reads the row", async () => {
    const { store, log, rows } = fakeStore();
    store.create = async () => {
      // The webhook inserts the same user between our read and our insert.
      rows.push(existingRow({ id: 9n, referenceId: "cref9", googleId: "user_new" }));
      log.creates += 1;
      throw p2002("googleId");
    };
    assert.deepEqual(await provisionUser("user_new", deps(store, clerkUser("verified"))), {
      status: "ok",
      userId: 9n,
      userRef: "cref9",
      created: false,
      relinked: false,
    });
  });

  it("Clerk unreachable or without the user → no write", async () => {
    const { store, log } = fakeStore();
    assert.deepEqual(await provisionUser("user_new", deps(store, new Error("ECONNRESET"))), { status: "clerk_unavailable" });
    assert.deepEqual(await provisionUser("user_new", deps(store, null)), { status: "clerk_user_missing" });
    assert.equal(log.creates, 0);
  });
});

describe("toClerkPayload", () => {
  it("maps the Backend API user to the webhook payload shape", () => {
    const payload = toClerkPayload({
      id: "user_1",
      emailAddresses: [{ id: "em", emailAddress: "a@b.test", verification: { status: "verified" } }],
      primaryEmailAddressId: "em",
      firstName: "A",
      lastName: null,
      username: null,
      imageUrl: "",
    });
    assert.deepEqual(payload, {
      id: "user_1",
      email_addresses: [{ id: "em", email_address: "a@b.test", verification: { status: "verified" } }],
      primary_email_address_id: "em",
      first_name: "A",
      last_name: null,
      username: null,
      image_url: null,
    });
  });
});
