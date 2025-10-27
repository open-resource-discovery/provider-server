/* eslint-disable @typescript-eslint/no-require-imports */
import { getAllFiles, getPackageVersion } from "../files.js";
import fs from "fs";

jest.mock("../logger.js", () => ({
  log: {
    error: jest.fn(),
  },
}));

jest.mock("fs", () => ({
  default: {
    promises: {
      access: jest.fn(),
      readdir: jest.fn(),
      stat: jest.fn(),
    },
    readFileSync: jest.fn(),
  },
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
  },
  readFileSync: jest.fn(),
}));

describe("files", () => {
  describe("getAllFiles", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return empty array when directory does not exist", async () => {
      (fs.promises.access as jest.Mock).mockRejectedValue(new Error("ENOENT"));

      const result = await getAllFiles("/nonexistent/path");

      expect(result).toEqual([]);
    });

    it("should list all files in a flat directory", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.readdir as jest.Mock).mockResolvedValue(["file1.txt", "file2.json"]);
      (fs.promises.stat as jest.Mock)
        .mockResolvedValueOnce({ isDirectory: () => false })
        .mockResolvedValueOnce({ isDirectory: () => false });

      const result = await getAllFiles("/test/dir");

      expect(result).toHaveLength(2);
      expect(result.some((f) => f.includes("file1.txt"))).toBe(true);
      expect(result.some((f) => f.includes("file2.json"))).toBe(true);
    });

    it("should recursively list files in nested directories", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);

      // First call - root directory
      (fs.promises.readdir as jest.Mock)
        .mockResolvedValueOnce(["file1.txt", "subdir"])
        .mockResolvedValueOnce(["file2.json"]); // subdir contents

      (fs.promises.stat as jest.Mock)
        .mockResolvedValueOnce({ isDirectory: () => false }) // file1.txt
        .mockResolvedValueOnce({ isDirectory: () => true }) // subdir
        .mockResolvedValueOnce({ isDirectory: () => false }); // file2.json in subdir

      const result = await getAllFiles("/test/dir");

      expect(result).toHaveLength(2);
      expect(result.some((f) => f.includes("file1.txt"))).toBe(true);
      expect(result.some((f) => f.includes("file2.json"))).toBe(true);
    });

    it("should handle empty directories", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);

      const result = await getAllFiles("/test/empty");

      expect(result).toEqual([]);
    });

    it("should accumulate files in provided array", async () => {
      (fs.promises.access as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.readdir as jest.Mock).mockResolvedValue(["file.txt"]);
      (fs.promises.stat as jest.Mock).mockResolvedValue({ isDirectory: () => false });

      const existingFiles = ["/existing/file.json"];
      const result = await getAllFiles("/test/dir", existingFiles);

      expect(result).toHaveLength(2);
      expect(result).toContain("/existing/file.json");
    });
  });

  describe("getPackageVersion", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return version from package.json", () => {
      const packageJson = { version: "1.2.3" };
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));

      const result = getPackageVersion();

      expect(result).toBe("1.2.3");
    });

    it("should return 'unknown' when version field is missing", () => {
      const packageJson = { name: "test-package" };
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(packageJson));

      const result = getPackageVersion();

      expect(result).toBe("unknown");
    });

    it("should return 'unknown' when package.json cannot be read", () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });

      const result = getPackageVersion();

      expect(result).toBe("unknown");
    });

    it("should return 'unknown' when package.json is invalid JSON", () => {
      (fs.readFileSync as jest.Mock).mockReturnValue("invalid json{");

      const result = getPackageVersion();

      expect(result).toBe("unknown");
    });

    it("should log error when package.json cannot be read", () => {
      const { log } = require("../logger.js");
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });

      getPackageVersion();

      expect(log.error).toHaveBeenCalled();
    });
  });
});
