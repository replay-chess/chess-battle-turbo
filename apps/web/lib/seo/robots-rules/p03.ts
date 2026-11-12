// Phase 3 robots.txt rules (phase-03 plan §3.2 robots row, §11.3). Pure data.
//
// The review, archive and practice pages are per-user and signed in; the public share pages `/r/<code>` are opt-in
// links that must never be indexed (they are also `noindex` by metadata and by the `X-Robots-Tag` header in
// next.config.js). How we grade stays indexable.
import type { RobotsRuleSet } from "./index";

export const rules: RobotsRuleSet = {
  disallow: ["/review/", "/r/", "/games", "/practice"],
};
