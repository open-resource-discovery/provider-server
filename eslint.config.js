import { withCustomConfig } from "@sap/eslint-config";

export default withCustomConfig([
  {
    ignores: ["dist", "reports", "public/**"],
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
]);
