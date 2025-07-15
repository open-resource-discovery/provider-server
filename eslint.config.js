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
    files: ["src/client/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "tsconfig.client.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
]);
