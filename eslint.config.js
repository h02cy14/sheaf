// Lint rules that enforce the engineering standards in the project brief (§8).
// The important ones: `any` is an error, and any eslint-disable comment must
// carry a description (`-- reason`). That is how "no `any` without a comment
// justifying it" is enforced mechanically rather than by review.
import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/gen/**", "**/coverage/**"],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  comments.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", minimumDescriptionLength: 10 },
      ],
    },
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Keeps the shell swappable (ADR 0001, "Escape hatch").
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/*"],
              message: "Only src/platform/ may import Tauri. Add what you need to its interface.",
            },
          ],
        },
      ],
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/*/src/platform/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Core is platform-independent; see packages/core/README.md.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "@tauri-apps/*", "react", "react-dom", "i18next", "react-i18next"],
              message: "@sheaf/core must stay platform-independent. Take an interface instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs}", "**/vite.config.ts", "**/vitest.config.ts", "**/*.test.ts"],
    languageOptions: { globals: globals.node },
  },
);
