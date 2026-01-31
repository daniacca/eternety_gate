import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsoncParser from "jsonc-eslint-parser";
import jsonc from "eslint-plugin-jsonc";

const jsFileGlobs = ["**/*.{js,jsx,mjs,cjs,ts,tsx}"];
const nodeGlobals = {
  module: "readonly",
  require: "readonly",
  __dirname: "readonly",
  console: "readonly",
  process: "readonly",
};
const browserGlobals = {
  window: "readonly",
  localStorage: "readonly",
  __DEV__: "readonly",
};
const testGlobals = {
  describe: "readonly",
  it: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  vi: "readonly",
};

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    ...js.configs.recommended,
    files: jsFileGlobs,
    languageOptions: {
      globals: {
        console: "readonly",
      },
    },
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: testGlobals,
    },
  },
  {
    files: ["babel.config.js", "metro.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
  },
  {
    files: ["packages/engine/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "packages/tools/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/play/**/*.{ts,tsx}", "packages/engine/src/runtime/magic/catalogs.ts"],
    languageOptions: {
      globals: {
        require: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["packages/tools/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: nodeGlobals,
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
