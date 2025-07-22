import { withCustomConfig } from "@sap/eslint-config";

export default withCustomConfig([
  {
    ignores: ["dist", "reports"],
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
