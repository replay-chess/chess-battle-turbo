// ESLint for the provider import library: the shared base config. The package is pure TypeScript plus fetch (no
// React), so the base rules are the whole set; `pnpm --filter @repo/chess-import lint` runs with --max-warnings 0.
import { config } from "@repo/eslint-config/base";

export default [...config, { ignores: ["node_modules/**"] }];
