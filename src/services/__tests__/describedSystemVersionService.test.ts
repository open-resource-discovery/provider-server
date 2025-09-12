import { getDefaultDescribedSystemVersion } from "../describedSystemVersionService.js";
import fs from "fs";
import path from "path";

// Mock fs module
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock path module
jest.mock("path");
const mockedPath = path as jest.Mocked<typeof path>;

// Mock process.cwd and process.env
const originalCwd = process.cwd;
const originalEnv = process.env;

describe("getDefaultDescribedSystemVersion", () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.ORD_INCLUDE_BUILD_NUMBER;

    // Mock process.cwd
    process.cwd = jest.fn().mockReturnValue("/test/directory");

    // Mock path.join
    mockedPath.join.mockReturnValue("/test/directory/package.json");
  });

  afterEach(() => {
    process.cwd = originalCwd;
    process.env = originalEnv;
  });

  it("should return version from package.json when available", () => {
    const packageJsonContent = JSON.stringify({ version: "2.1.0" });

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(packageJsonContent);

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "2.1.0" });
    expect(mockedPath.join).toHaveBeenCalledWith("/test/directory", "package.json");
    expect(mockedFs.existsSync).toHaveBeenCalledWith("/test/directory/package.json");
    expect(mockedFs.readFileSync).toHaveBeenCalledWith("/test/directory/package.json", "utf-8");
  });

  it("should return fallback version when package.json does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.0.0" });
    expect(mockedFs.readFileSync).not.toHaveBeenCalled();
  });

  it("should return fallback version when package.json has no version field", () => {
    const packageJsonContent = JSON.stringify({ name: "test-package" });

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(packageJsonContent);

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.0.0" });
  });

  it("should return fallback version when package.json is invalid JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("invalid json");

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.0.0" });
  });

  it("should return fallback version when fs operations throw error", () => {
    mockedFs.existsSync.mockImplementation(() => {
      throw new Error("File system error");
    });

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.0.0" });
  });

  it("should append build number when ORD_INCLUDE_BUILD_NUMBER is true", () => {
    process.env.ORD_INCLUDE_BUILD_NUMBER = "true";

    const packageJsonContent = JSON.stringify({ version: "1.5.0" });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(packageJsonContent);

    // Mock Date to return a fixed date
    const mockDate = new Date("2025-09-12T10:27:00.000Z");
    jest.spyOn(global, "Date").mockImplementation(() => mockDate);

    const result = getDefaultDescribedSystemVersion();

    expect(result.version).toMatch(/^1\.5\.0\+202509121027$/);

    // Restore Date mock
    jest.restoreAllMocks();
  });

  it("should not append build number when ORD_INCLUDE_BUILD_NUMBER is false", () => {
    process.env.ORD_INCLUDE_BUILD_NUMBER = "false";

    const packageJsonContent = JSON.stringify({ version: "1.5.0" });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(packageJsonContent);

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.5.0" });
  });

  it("should not append build number when ORD_INCLUDE_BUILD_NUMBER is undefined", () => {
    // ORD_INCLUDE_BUILD_NUMBER is already undefined from beforeEach

    const packageJsonContent = JSON.stringify({ version: "1.5.0" });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(packageJsonContent);

    const result = getDefaultDescribedSystemVersion();

    expect(result).toEqual({ version: "1.5.0" });
  });
});
