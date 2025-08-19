import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.circleci/**",
      "**/.git/**",
      "**/.github/**",
    ],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser },
  },
  ...tseslint.configs.recommended,
  {
    // Apply rules specifically to TypeScript files
    files: ["**/*.{ts,mts,cts}"],
    rules: {
      // Disable the base rule to avoid conflicts
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn", // Or "error" for stricter enforcement
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);
