import * as fs from "fs";
import * as crypto from "crypto";
import { calculateDirectoryHash } from "../directoryHash.js";
import { getAllFiles } from "../files.js";

jest.mock("fs");
jest.mock("../files.js");
jest.mock("../logger.js", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe("directoryHash", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateDirectoryHash", () => {
    it("should calculate hash for directory with files", async () => {
      const mockDirectoryPath = "/test/directory";
      const mockFiles = ["/test/directory/file2.txt", "/test/directory/file1.txt"];
      const mockStats = { mtimeMs: 1234567890 };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(mockFiles);
      (fs.statSync as jest.Mock).mockReturnValue(mockStats);

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBeTruthy();
      expect(result).toHaveLength(64); // SHA-256 hex digest is 64 characters
      expect(fs.existsSync).toHaveBeenCalledWith(mockDirectoryPath);
      expect(getAllFiles).toHaveBeenCalledWith(mockDirectoryPath);
      expect(fs.statSync).toHaveBeenCalledTimes(2);
    });

    it("should return null when directory does not exist", async () => {
      const mockDirectoryPath = "/nonexistent/directory";

      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBeNull();
      expect(fs.existsSync).toHaveBeenCalledWith(mockDirectoryPath);
      expect(getAllFiles).not.toHaveBeenCalled();
    });

    it("should handle empty directory", async () => {
      const mockDirectoryPath = "/test/empty";
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue([]);

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBeTruthy();
      expect(result).toHaveLength(64);
      expect(getAllFiles).toHaveBeenCalledWith(mockDirectoryPath);
      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it("should sort files for consistent hash calculation", async () => {
      const mockDirectoryPath = "/test/directory";
      const mockFiles = ["/test/directory/zebra.txt", "/test/directory/apple.txt"];
      const mockStats = { mtimeMs: 1234567890 };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(mockFiles);
      (fs.statSync as jest.Mock).mockReturnValue(mockStats);

      const result1 = await calculateDirectoryHash(mockDirectoryPath);

      // Reset and calculate again with reversed array
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue([...mockFiles].reverse());
      (fs.statSync as jest.Mock).mockReturnValue(mockStats);

      const result2 = await calculateDirectoryHash(mockDirectoryPath);

      // Hash should be the same regardless of initial order
      expect(result1).toBe(result2);
    });

    it("should return different hashes for different modification times", async () => {
      const mockDirectoryPath = "/test/directory";
      const mockFiles = ["/test/directory/file.txt"];

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(mockFiles);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1111111111 });

      const result1 = await calculateDirectoryHash(mockDirectoryPath);

      // Reset and calculate with different mtime
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(mockFiles);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 2222222222 });

      const result2 = await calculateDirectoryHash(mockDirectoryPath);

      expect(result1).not.toBe(result2);
    });

    it("should return null on error during hash calculation", async () => {
      const mockDirectoryPath = "/test/directory";
      const mockFiles = ["/test/directory/file.txt"];

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(mockFiles);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBeNull();
    });

    it("should return null on error from getAllFiles", async () => {
      const mockDirectoryPath = "/test/directory";

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockRejectedValue(new Error("Read error"));

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBeNull();
    });

    it("should hash file path and modification time", async () => {
      const mockDirectoryPath = "/test/directory";
      const mockFile = "/test/directory/file.txt";
      const mockMtimeMs = 1234567890;

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue([mockFile]);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: mockMtimeMs });

      // Calculate expected hash manually
      const expectedHash = crypto.createHash("sha256");
      expectedHash.update(mockFile + mockMtimeMs);
      const expectedDigest = expectedHash.digest("hex");

      const result = await calculateDirectoryHash(mockDirectoryPath);

      expect(result).toBe(expectedDigest);
    });
  });
});
