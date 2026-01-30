import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsoncParser from "jsonc-eslint-parser";
import jsonc from "eslint-plugin-jsonc";

const jsFileGlobs = ["**/*.{js,jsx,mjs,cjs,ts,tsx}"];

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    ...js.configs.recommended,
    files: jsFileGlobs,
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
  {
    files: ["**/*.json"],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc,
    },
    rules: {
      ...jsonc.configs["recommended-with-json"].rules,
    },
  },
];
