// ESLint for the grading library: the shared base config. The package is pure (no DOM, no React), so the base rules
// are the whole set; `pnpm --filter @repo/chess-analysis lint` runs with --max-warnings 0.
import { config } from "@repo/eslint-config/base";

export default [...config, { ignores: ["node_modules/**"] }];
