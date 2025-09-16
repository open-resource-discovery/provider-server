import { pathsToModuleNameMapper } from "ts-jest";
import fs from "fs";

const { compilerOptions } = JSON.parse(fs.readFileSync("./tsconfig.json"));

export default {
  preset: "ts-jest/presets/default-esm",
  modulePaths: [compilerOptions.baseUrl],
  moduleNameMapper: {
    ...pathsToModuleNameMapper(compilerOptions.paths, { useESM: true }),
    "@octokit/rest": "<rootDir>/src/__mocks__/@octokit/rest.ts",
  },
  testEnvironment: "node",
  automock: false,
  moduleFileExtensions: ["js", "json", "ts", "d.ts"],
  moduleDirectories: ["node_modules"],
  modulePathIgnorePatterns: ["src/__tests__/resources/"],
  transformIgnorePatterns: ["node_modules/(?!(@octokit|p-limit|yocto-queue)/)"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
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
