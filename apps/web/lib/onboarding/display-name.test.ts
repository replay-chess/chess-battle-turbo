// The greeting name (phase-04 plan §8.13, §12.1 display-name.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISPLAY_NAME_MAX, PLACEHOLDER_NAME, accountName, displayName, emailLocalName, initialsOf, realName } from "./display-name";

describe("displayName: the fallback chain", () => {
  it("1. the Clerk username wins", () => {
    assert.equal(
      displayName({ clerkUsername: "knightowl_88", linkedUsernames: ["hikaru"], name: "Ana Lima", email: "ana@example.com" }),
      "knightowl_88",
    );
  });

  it("2. then the first linked account's username", () => {
    assert.equal(displayName({ clerkUsername: null, linkedUsernames: ["hikaru", "DrNykterstein"], name: "Ana Lima" }), "hikaru");
    assert.equal(displayName({ clerkUsername: "   ", linkedUsernames: ["", "DrNykterstein"], name: "Ana Lima" }), "DrNykterstein");
  });

  it("3. then the first word of users.name", () => {
    assert.equal(displayName({ name: "Ana  Lima Souza", email: "ana@example.com" }), "Ana");
    assert.equal(displayName({ name: "  Magnus ", email: "m@example.com" }), "Magnus");
  });

  it("the provisioning placeholder is not a name", () => {
    assert.equal(displayName({ name: PLACEHOLDER_NAME, email: "rook.lover@example.com" }), "rook.lover");
  });

  it("4. then the email's local part", () => {
    assert.equal(displayName({ name: "", email: "pawn+tag@example.com" }), "pawn", "without the sub-address (D5)");
    assert.equal(displayName({ name: null, email: "a@b@example.com" }), "a@b");
  });

  it("5. finally 'there'", () => {
    assert.equal(displayName({}), "there");
    assert.equal(displayName({ name: "", email: "@example.com" }), "there");
    assert.equal(displayName({ name: PLACEHOLDER_NAME, email: null }), "there");
  });

  it("strips control characters and angle brackets, and caps the length", () => {
    assert.equal(displayName({ clerkUsername: "<b>bold</b>\u0007" }), "bbold/b");
    const long = "x".repeat(80);
    assert.equal(displayName({ clerkUsername: long }).length, DISPLAY_NAME_MAX);
  });
});

describe("initialsOf", () => {
  it("two words → their first letters; a username's digit suffix is not a word", () => {
    assert.equal(initialsOf("Ana Lima"), "AL");
    assert.equal(initialsOf("knightowl_88"), "KN");
    assert.equal(initialsOf("bishop_pair_bob"), "BP");
    assert.equal(initialsOf("DrNykterstein"), "DR");
    assert.equal(initialsOf("1984"), "19");
    assert.equal(initialsOf("!!!"), "?");
  });
});

describe("D5: no +tag, no placeholder, anywhere the member's name shows", () => {
  it("regression: D5 (welcome-plus-tag): the email fallback drops the sub-address", () => {
    assert.equal(displayName({ name: PLACEHOLDER_NAME, email: "p4pass.b8fdec7e+clerk_test@example.com" }), "p4pass.b8fdec7e");
    assert.equal(emailLocalName("ana+chess@x.io"), "ana");
    assert.equal(emailLocalName("+tag@x.io"), null, "nothing left: the chain goes on");
    assert.equal(displayName({ email: "+tag@x.io" }), "there");
  });
  it("regression: D5 (anonymous-user): accountName skips Clerk's placeholder for the shell and the review", () => {
    assert.equal(accountName({ name: PLACEHOLDER_NAME, email: "p4pass.b8fdec7e+clerk_test@example.com" }), "p4pass.b8fdec7e");
    assert.equal(accountName({ name: "Ada Lovelace", email: "ada@x.io" }), "Ada Lovelace", "a real name stays whole");
    assert.equal(accountName({ name: PLACEHOLDER_NAME, email: null }), "Member");
    assert.equal(realName(PLACEHOLDER_NAME), null);
    assert.equal(realName("  "), null);
    assert.equal(realName("Ana Lima"), "Ana Lima");
  });
});
