import assert from "node:assert/strict";
import { it } from "node:test";
import { PROVIDER_AVATARS_ENABLED, accountInitials, renderableAvatarUrl } from "./avatars";

it("avatars stay off until OD-2 clears (D4-26): initials only", () => {
  assert.equal(PROVIDER_AVATARS_ENABLED, false);
  assert.equal(renderableAvatarUrl("https://images.chesscomfiles.com/a.png"), null);
});

it("initials", () => {
  assert.equal(accountInitials("knightowl_88"), "KN");
  assert.equal(accountInitials("Magnus Carlsen"), "MC");
  assert.equal(accountInitials("x"), "X");
  assert.equal(accountInitials("  "), "?");
});
