import assert from "node:assert/strict";
import test from "node:test";
import {
  filterBlogPostsByTag,
  getBlogTagHref,
  normalizeBlogTag,
  summarizeBlogTags,
} from "@/lib/blog-tags";

test("normalizes tag identity without changing its words", () => {
  assert.equal(normalizeBlogTag("  King's   Gambit "), "king's gambit");
});

test("groups shared tags case-insensitively and counts articles once", () => {
  const tags = summarizeBlogTags([
    { tags: ["King's Gambit", "Attack"] },
    { tags: ["king's gambit", "Endgames"] },
    { tags: ["KING'S GAMBIT", "king's gambit"] },
  ]);

  assert.deepEqual(tags, [
    { value: "attack", label: "Attack", count: 1 },
    { value: "endgames", label: "Endgames", count: 1 },
    { value: "king's gambit", label: "King's Gambit", count: 3 },
  ]);
});

test("filters articles by normalized tag identity", () => {
  const posts = [
    { slug: "one", tags: ["King Safety", "Tactics"] },
    { slug: "two", tags: ["Endgames"] },
  ];

  assert.deepEqual(
    filterBlogPostsByTag(posts, " king   safety ").map((post) => post.slug),
    ["one"],
  );
});

test("creates a shareable encoded blog filter URL", () => {
  assert.equal(getBlogTagHref("King's Gambit"), "/blog?tag=king%27s+gambit");
});
