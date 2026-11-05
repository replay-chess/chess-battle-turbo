import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaletteRows, filterRows, legendRows, legendSearchUrl, parseLegendSearch } from "./palette";

const me = { referenceId: "ref" };
const rows = (over: Partial<Parameters<typeof buildPaletteRows>[0]> = {}) =>
  buildPaletteRows({ me, isAdmin: false, theme: "light", ...over });

test('"tour" leaves Tournaments only', () => {
  assert.deepEqual(
    filterRows(rows(), "tour").map((r) => r.id),
    ["tournaments"],
  );
  assert.deepEqual(
    filterRows(rows(), "  TOUR ").map((r) => r.id),
    ["tournaments"],
  );
});

test('"" gives the curated order', () => {
  assert.deepEqual(
    filterRows(rows(), "").map((r) => r.id),
    [
      "play",
      "tournaments",
      "legends",
      "openings",
      "profile",
      "membership",
      "find-opponent",
      "challenge",
      "shortcuts",
      "theme",
      "signout",
    ],
  );
});

test("the hint is searchable and group order is kept", () => {
  assert.deepEqual(
    filterRows(rows(), "g then").map((r) => r.id),
    ["play", "legends"],
  );
  const order = ["goto", "actions", "legends"];
  const groups = filterRows(rows({ isAdmin: true }), "a").map((r) => order.indexOf(r.group));
  assert.deepEqual(
    groups,
    [...groups].sort((a, b) => a - b),
  );
});

test("the admin row appears only for admins; sign out not in demo", () => {
  assert.equal(
    rows().some((r) => r.id === "admin"),
    false,
  );
  assert.equal(
    rows({ isAdmin: true }).some((r) => r.id === "admin"),
    true,
  );
  assert.equal(
    rows({ demo: true }).some((r) => r.id === "signout"),
    false,
  );
});

test("hrefs: own profile and membership, hashes in demo", () => {
  const byId = (rs: ReturnType<typeof rows>, id: string) => rs.find((r) => r.id === id);
  assert.equal(byId(rows(), "profile")?.href, "/profile/ref");
  assert.equal(byId(rows(), "membership")?.href, "/profile/ref#membership");
  assert.equal(byId(rows({ demo: true }), "profile")?.href, "#profile");
  assert.equal(byId(rows({ demo: true }), "membership")?.href, "#membership");
  assert.equal(byId(rows(), "find-opponent")?.href, "/queue?time=300&increment=3");
});

test("the theme row offers the other theme", () => {
  assert.equal(rows({ theme: "light" }).find((r) => r.id === "theme")?.title, "Switch to Dark Theme");
  assert.equal(rows({ theme: "dark" }).find((r) => r.id === "theme")?.title, "Switch to Light Theme");
});

test("legend rows keep only isVisible and cap at 5", () => {
  const legends = Array.from({ length: 8 }, (_, i) => ({
    referenceId: `l${i}`,
    name: `Legend ${i}`,
    isVisible: i !== 1,
  }));
  const out = legendRows(legends);
  assert.equal(out.length, 5);
  assert.deepEqual(
    out.map((r) => r.id),
    ["legend-l0", "legend-l2", "legend-l3", "legend-l4", "legend-l5"],
  );
  assert.equal(out[0]?.href, "/legends/l0");
  assert.equal(out[0]?.hint, "Legend");
  assert.equal(legendRows([{ referenceId: "x", name: "No Flag" }]).length, 0, "missing isVisible counts as hidden");
});

test("parseLegendSearch reads data.legends and tolerates junk", () => {
  assert.deepEqual(
    parseLegendSearch({
      success: true,
      data: { query: "m", count: 1, legends: [{ referenceId: "a", name: "Paul Morphy", isVisible: true }] },
    }),
    [{ referenceId: "a", name: "Paul Morphy", isVisible: true }],
  );
  assert.deepEqual(parseLegendSearch({ error: "x" }), []);
  assert.deepEqual(parseLegendSearch(null), []);
  assert.deepEqual(parseLegendSearch({ data: { legends: [null, { name: 3 }] } }), []);
  assert.equal(legendSearchUrl(" morphy "), "/api/legends/search?name=morphy");
});
