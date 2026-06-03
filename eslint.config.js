import { withCustomConfig } from "@sap/eslint-config";

export default withCustomConfig([
  {
    ignores: ["dist", "reports"],
  },
  {
    // typescript-eslint < 8.58.0 misreads TS6 types, causing false positives.
    // Remove this override once @sap/eslint-config ships typescript-eslint >= 8.58.0.
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/prefer-readonly": "off",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        WebSocket: "readonly",
        navigator: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
]);
