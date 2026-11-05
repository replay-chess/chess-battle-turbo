// Phase 1 robots.txt rules (moved verbatim from app/robots.ts by 1B·J). Pure data.
//
// Indexing decisions live in page metadata. These paths are blocked only because they are non-content
// infrastructure or unbounded session URLs.
import type { RobotsRuleSet } from "./index";

export const rules: RobotsRuleSet = {
  disallow: [
    "/api/",
    "/admin/",
    "/monitoring",
    "/game/",
    "/analysis/",
    "/join/",
    "/join-tournament/",
    "/queue",
    "/position/",
    "/tournament/",
    "/dev/",
  ],
};
