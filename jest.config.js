import { pathsToModuleNameMapper } from "ts-jest";
import fs from "fs";

const { compilerOptions } = JSON.parse(fs.readFileSync("./tsconfig.json"));

export default {
  preset: "ts-jest/presets/default-esm",
  modulePaths: ["."],
  testEnvironment: "node",
  automock: false,
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { useESM: true, prefix: "<rootDir>/" }),
  moduleFileExtensions: ["js", "json", "ts", "d.ts"],
  moduleDirectories: ["node_modules"],
  // content-disposition@3 is ESM-only and is loaded via @fastify/static's CommonJS require().
  // The default-esm preset only transforms .ts/.tsx, so content-disposition's dist/index.js
  // has no JS transformer and fails to load. Unignore it from transformIgnorePatterns AND add a
  // ts-jest transform that compiles its ESM .js down to CommonJS so @fastify/static's require() works.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
    "node_modules/content-disposition/.+\\.js$": [
      "ts-jest",
      { useESM: false, isolatedModules: true, tsconfig: { allowJs: true, module: "CommonJS", target: "ES2022" } },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!(?:content-disposition)/)"],
  modulePathIgnorePatterns: ["src/__tests__/resources/", "dist/"],
  coverageDirectory: "reports/jest-coverage",
  coveragePathIgnorePatterns: [
    "/(src|tests)/__(test|integrationTests|systemTests|mocks)__/",
    "/resources/",
    "/node_modules/",
  ],
  coverageReporters: ["lcov", "text"],
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "reports/jest-coverage",
        suiteName: "jest tests",
      },
    ],
  ],
  roots: ["<rootDir>/"],
  setupFilesAfterEnv: ["./jest.setup.js", "<rootDir>/src/__tests__/setup/testSetup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  testTimeout: 30000,
  watchPlugins: ["jest-watch-typeahead/filename", "jest-watch-typeahead/testname"],
  testEnvironmentOptions: {
    NODE_OPTIONS: "--experimental-vm-modules",
  },
};
