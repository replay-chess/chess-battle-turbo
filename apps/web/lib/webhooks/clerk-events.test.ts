import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  USER_CODE_ALPHABET,
  clerkEventTime,
  displayName,
  generateUserCode,
  handleClerkEvent,
  isUniqueViolation,
  primaryVerifiedEmail,
  type ClerkUserPayload,
  type ClerkUserRow,
  type ClerkUserStore,
  type NewUserInput,
} from "./clerk-events";

function payload(overrides: Partial<ClerkUserPayload> = {}, status = "verified"): ClerkUserPayload {
  return {
    id: "user_new",
    email_addresses: [
      { id: "idn_2", email_address: "other@example.test", verification: { status: "verified" } },
      { id: "idn_1", email_address: " New@Example.TEST ", verification: { status } },
    ],
    primary_email_address_id: "idn_1",
    first_name: "Ada",
    last_name: "Lovelace",
    image_url: "https://img.example.test/a.png",
    ...overrides,
  };
}

function row(overrides: Partial<ClerkUserRow> = {}): ClerkUserRow {
  return {
    id: 1n,
    referenceId: "ref_1",
    googleId: "user_old",
    email: "old@example.test",
    name: "Old Name",
    profilePictureUrl: null,
    isActive: true,
    ...overrides,
  };
}

class FakeStore implements ClerkUserStore {
  rows: ClerkUserRow[];
  created: Array<{ input: NewUserInput; code: string }> = [];
  updates: Array<[bigint, Record<string, unknown>]> = [];
  warnings: string[] = [];
  createErrors: unknown[] = [];
  constructor(rows: ClerkUserRow[] = []) {
    this.rows = rows;
  }
  async findByGoogleId(googleId: string) {
    return this.rows.find((r) => r.googleId === googleId) ?? null;
  }
  async findByEmail(email: string) {
    return this.rows.find((r) => r.email === email) ?? null;
  }
  async create(input: NewUserInput, code: string) {
    const err = this.createErrors.shift();
    if (err) throw err;
    this.created.push({ input, code });
    const r = row({ id: 100n + BigInt(this.created.length), referenceId: "ref_new", ...input });
    this.rows.push(r);
    return r;
  }
  async update(id: bigint, data: Record<string, unknown>) {
    this.updates.push([id, data]);
    Object.assign(this.rows.find((r) => r.id === id)!, data);
  }
  async deactivate(googleId: string) {
    const r = this.rows.find((x) => x.googleId === googleId);
    if (!r) return null;
    r.isActive = false;
    return { id: r.id, referenceId: r.referenceId };
  }
  warn(message: string) {
    this.warnings.push(message);
  }
}

const p2002 = (target: string[]) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

describe("primaryVerifiedEmail / displayName", () => {
  it("takes the primary address only when verified, normalised", () => {
    assert.equal(primaryVerifiedEmail(payload()), "new@example.test");
    assert.equal(primaryVerifiedEmail(payload({}, "unverified")), null);
    assert.equal(primaryVerifiedEmail(payload({ primary_email_address_id: null })), null);
  });
  it("builds a display name", () => {
    assert.equal(displayName(payload()), "Ada Lovelace");
    assert.equal(displayName(payload({ first_name: null, last_name: null, username: "ada" })), "ada");
    assert.equal(displayName(payload({ first_name: null, last_name: null })), "Anonymous User");
  });
  it("user codes are 6 characters from [A-Z0-9]", () => {
    for (let i = 0; i < 50; i++) assert.match(generateUserCode(), /^[A-Z0-9]{6}$/);
    assert.equal(generateUserCode(() => 0), "AAAAAA");
    assert.equal(generateUserCode((n) => n - 1), USER_CODE_ALPHABET.at(-1)!.repeat(6));
  });
});

describe("user.created", () => {
  it("creates the user with a code and asks for the default claims", async () => {
    const store = new FakeStore();
    const out = await handleClerkEvent({ type: "user.created", data: payload() }, store);
    assert.equal(out.status, "applied");
    assert.equal(out.changed, true);
    assert.equal(out.claims, "new");
    assert.equal(out.clerkUserId, "user_new");
    assert.deepEqual(store.created[0]!.input, {
      googleId: "user_new",
      email: "new@example.test",
      name: "Ada Lovelace",
      profilePictureUrl: "https://img.example.test/a.png",
    });
  });

  it("is a no-op for a row that already exists (request path won), with a claims sync", async () => {
    const store = new FakeStore([row({ googleId: "user_new" })]);
    const out = await handleClerkEvent({ type: "user.created", data: payload() }, store);
    assert.deepEqual([out.status, out.changed, out.claims, out.userId], ["applied", false, "sync", 1n]);
    assert.equal(store.created.length, 0);
  });

  it("relinks an existing row by verified primary email (AA F-23)", async () => {
    const store = new FakeStore([row({ email: "new@example.test", isActive: false })]);
    const out = await handleClerkEvent({ type: "user.created", data: payload() }, store);
    assert.deepEqual([out.status, out.changed, out.claims], ["applied", true, "sync"]);
    assert.deepEqual(store.updates, [[1n, { googleId: "user_new", isActive: true }]]);
    assert.deepEqual(store.warnings, ["user.relinked"]);
  });

  it("never creates or relinks from an unverified email", async () => {
    const store = new FakeStore([row({ email: "new@example.test" })]);
    const out = await handleClerkEvent({ type: "user.created", data: payload({}, "unverified") }, store);
    assert.deepEqual([out.status, out.error], ["ignored", "unverified_email"]);
    assert.equal(store.created.length + store.updates.length, 0);
  });

  it("retries a code collision, and re-reads when the request path created the row first", async () => {
    const store = new FakeStore();
    store.createErrors = [p2002(["code"])];
    const out = await handleClerkEvent({ type: "user.created", data: payload() }, store);
    assert.equal(out.claims, "new");
    assert.equal(store.created.length, 1);

    const racing = new FakeStore();
    racing.createErrors = [p2002(["googleId"])];
    racing.create = async () => {
      racing.rows.push(row({ id: 5n, googleId: "user_new", email: "new@example.test" }));
      throw p2002(["googleId"]);
    };
    const raced = await handleClerkEvent({ type: "user.created", data: payload() }, racing);
    assert.deepEqual([raced.status, raced.changed, raced.userId, raced.claims], ["applied", false, 5n, "sync"]);
  });

  it("propagates other database errors (the route marks the event error, 500)", async () => {
    const store = new FakeStore();
    store.createErrors = [Object.assign(new Error("db down"), { code: "P1001" })];
    await assert.rejects(handleClerkEvent({ type: "user.created", data: payload() }, store), /db down/);
  });
});

describe("user.updated", () => {
  it("updates name, picture and a verified, unused email", async () => {
    const store = new FakeStore([row({ googleId: "user_new" })]);
    const out = await handleClerkEvent({ type: "user.updated", data: payload() }, store);
    assert.deepEqual([out.status, out.changed], ["applied", true]);
    assert.deepEqual(store.updates[0]![1], {
      name: "Ada Lovelace",
      profilePictureUrl: "https://img.example.test/a.png",
      email: "new@example.test",
    });
  });

  it("keeps the email and warns email_conflict when another row has it", async () => {
    const store = new FakeStore([row({ googleId: "user_new" }), row({ id: 2n, googleId: "user_x", email: "new@example.test" })]);
    await handleClerkEvent({ type: "user.updated", data: payload() }, store);
    assert.equal("email" in store.updates[0]![1], false);
    assert.deepEqual(store.warnings, ["email_conflict"]);
  });

  it("ignores an unverified new primary email; writes nothing when nothing changed", async () => {
    const store = new FakeStore([
      row({ googleId: "user_new", name: "Ada Lovelace", profilePictureUrl: "https://img.example.test/a.png" }),
    ]);
    const out = await handleClerkEvent({ type: "user.updated", data: payload({}, "unverified") }, store);
    assert.deepEqual([out.status, out.changed], ["applied", false]);
    assert.equal(store.updates.length, 0);
  });

  it("unmatched when the user was never provisioned", async () => {
    const out = await handleClerkEvent({ type: "user.updated", data: payload() }, new FakeStore());
    assert.equal(out.status, "unmatched");
  });
});

describe("user.deleted and others", () => {
  it("soft-deletes", async () => {
    const store = new FakeStore([row({ googleId: "user_new" })]);
    const out = await handleClerkEvent({ type: "user.deleted", data: { id: "user_new", deleted: true } }, store);
    assert.deepEqual([out.status, out.changed, out.userId], ["applied", true, 1n]);
    assert.equal(store.rows[0]!.isActive, false);
    assert.equal((await handleClerkEvent({ type: "user.deleted", data: { id: "user_zz" } }, store)).status, "unmatched");
  });

  it("ignores other event types and payloads without an id", async () => {
    assert.equal((await handleClerkEvent({ type: "session.created", data: {} }, new FakeStore())).status, "ignored");
    assert.equal((await handleClerkEvent({ type: "user.created", data: {} }, new FakeStore())).status, "ignored");
  });
});

describe("clerkEventTime / isUniqueViolation", () => {
  it("prefers the body timestamp (ms), then svix-timestamp (s)", () => {
    assert.equal(clerkEventTime('{"timestamp":1762336800000}', "1")?.toISOString(), "2025-11-05T10:00:00.000Z");
    assert.equal(clerkEventTime("{}", "1762336800")?.toISOString(), "2025-11-05T10:00:00.000Z");
    assert.equal(clerkEventTime("not json", null), null);
  });
  it("matches the unique target", () => {
    assert.equal(isUniqueViolation(p2002(["code"]), "code"), true);
    assert.equal(isUniqueViolation(p2002(["email"]), "code"), false);
    assert.equal(isUniqueViolation(new Error("x"), "code"), false);
  });
});
