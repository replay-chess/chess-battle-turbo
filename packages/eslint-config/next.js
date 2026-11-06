import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import pluginNext from "@next/eslint-plugin-next";
import { config as baseConfig } from "./base.js";
import { replayPlugin } from "./replay-rules.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
  },
  // @repo/contracts/internal (service HMAC keys) never reaches client code (phase-02 plan §7.5.1): any file with
  // "use client", and every file under components/ and features/ except *.server.ts(x).
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { replay: replayPlugin },
    rules: { "replay/no-internal-auth-in-client": "error" },
  },
  {
    files: ["components/**/*.{ts,tsx,js,jsx}", "features/**/*.{ts,tsx,js,jsx}"],
    ignores: ["**/*.server.ts", "**/*.server.tsx", "**/*.test.ts", "**/*.test.tsx"],
    plugins: { replay: replayPlugin },
    rules: { "replay/no-internal-auth-in-client": ["error", { always: true }] },
  },
];
