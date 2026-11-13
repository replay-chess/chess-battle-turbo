// /settings/connected loading state (phase-04 plan §4.10). regression: connected-skeleton-header-shift (FIX-2, UI review
// round 2): the skeleton passed no profile link, so the tab-bar top bar showed the logo while loading (overlapping the
// title at iPhone 125 %) and switched to "‹ Profile" when the data landed.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { before, describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";

// The frame imports its stylesheet (Next bundles it); plain Node gets an empty module for it.
nodeModule.registerHooks({
  resolve: (specifier, context, next) =>
    specifier.endsWith(".css") ? { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true } : next(specifier, context),
});
(globalThis as unknown as { React: typeof React }).React = React;
let mod: typeof import("./ConnectedSkeleton");
before(async () => {
  mod = await import("./ConnectedSkeleton");
});

function render(me: unknown, props: Record<string, unknown> = {}) {
  const qc = new QueryClient();
  if (me) qc.setQueryData(qk.me(), me);
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(mod.ConnectedSkeleton, props)));
}

describe("ConnectedSkeleton", () => {
  it("has the loaded page's profile link from the cached viewer, without fetching it", () => {
    assert.equal(mod.skeletonProfileHref({ user: { ref: "cref123" } } as never), "/profile/cref123");
    assert.equal(mod.skeletonProfileHref(undefined), null);
    const html = render({ user: { ref: "cref123" } });
    assert.match(html, /href="\/profile\/cref123"/);
    assert.match(html, /data-testid="settings-connected-profile"/);
    assert.match(html, /Loading your linked accounts/);
  });

  it("an explicit link wins (the demo); no cached viewer → no link (nothing is fetched)", () => {
    assert.match(render({ user: { ref: "cref123" } }, { profileHref: "/dev/ui/connected" }), /href="\/dev\/ui\/connected"/);
    assert.doesNotMatch(render(null), /settings-connected-profile/);
  });
});
