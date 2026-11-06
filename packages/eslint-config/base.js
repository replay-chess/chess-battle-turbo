import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";
import { replayPlugin, ROOM_LITERAL_EXEMPT } from "./replay-rules.js";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  // Room names come only from ROOM in @repo/contracts/socket/rooms (phase-02 plan §7.4.3).
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: ROOM_LITERAL_EXEMPT,
    plugins: { replay: replayPlugin },
    rules: { "replay/no-room-literal": "error" },
  },
  {
    ignores: ["dist/**", ".next/**"],
  },
];
