import { LocalDocumentRepository } from "../localDocumentRepository.js";
import fs from "fs";
import { getAllFiles } from "../../util/files.js";
import { log } from "../../util/logger.js";

jest.mock("fs");
jest.mock("../../util/files.js");
jest.mock("../../util/logger.js");
jest.mock("../../util/validateOrdDocument.js");

describe("LocalDocumentRepository", () => {
  let repository: LocalDocumentRepository;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: directory exists
    (mockFs.statSync as jest.Mock).mockReturnValue({ isDirectory: (): boolean => true });
  });

  describe("constructor and initialization", () => {
    it("should initialize with valid directory", () => {
      repository = new LocalDocumentRepository("/test/dir");
      expect(repository).toBeDefined();
    });

    it("should handle non-existent directory", () => {
      (mockFs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      repository = new LocalDocumentRepository("/nonexistent");

      expect(repository).toBeDefined();
      // Should set directoryExists to false internally
    });

    it("should handle path that is not a directory", () => {
      (mockFs.statSync as jest.Mock).mockReturnValue({ isDirectory: (): boolean => false });

      repository = new LocalDocumentRepository("/file.txt");

      expect(repository).toBeDefined();
    });
  });

  describe("getOrdDirectory", () => {
    it("should return the ORD directory path", () => {
      repository = new LocalDocumentRepository("/test/dir");

      expect(repository.getOrdDirectory()).toBe("/test/dir");
    });
  });

  describe("getDocument", () => {
    beforeEach(() => {
      repository = new LocalDocumentRepository("/test/dir");
    });

    it("should return document when valid ORD document exists", async () => {
      const mockDocument = {
        openResourceDiscovery: "1.9",
        $schema: "test",
        description: "Test document",
      };

      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockDocument));

      const result = await repository.getDocument("doc.json");

      expect(result).toEqual(mockDocument);
    });

    it("should return null for non-.json files", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await repository.getDocument("file.txt");

      expect(result).toBeNull();
    });

    it("should return null when file does not exist", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await repository.getDocument("missing.json");

      expect(result).toBeNull();
    });

    it("should warn and return null for invalid ORD document", async () => {
      const invalidDoc = { notOrd: "invalid" };

      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(invalidDoc));

      const result = await repository.getDocument("invalid.json");

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("is not a valid ORD document"));
    });

    it("should handle file read errors", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await repository.getDocument("doc.json");

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Error reading local document"));
    });

    it("should handle JSON parse errors", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("invalid json{");

      const result = await repository.getDocument("doc.json");

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("getDocuments", () => {
    beforeEach(() => {
      repository = new LocalDocumentRepository("/test/dir");
    });

    it("should return map of all valid documents in directory", async () => {
      const mockDoc1 = { openResourceDiscovery: "1.9", description: "Doc 1" };
      const mockDoc2 = { openResourceDiscovery: "1.9", description: "Doc 2" };

      (getAllFiles as jest.Mock).mockResolvedValue(["/test/dir/subdir/doc1.json", "/test/dir/subdir/doc2.json"]);
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock)
        .mockReturnValueOnce(JSON.stringify(mockDoc1))
        .mockReturnValueOnce(JSON.stringify(mockDoc2));

      const result = await repository.getDocuments("subdir");

      expect(result.size).toBe(2);
    });

    it("should skip non-JSON files", async () => {
      (getAllFiles as jest.Mock).mockResolvedValue(["/test/dir/file.txt", "/test/dir/doc.json"]);
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ openResourceDiscovery: "1.9" }));

      const result = await repository.getDocuments(".");

      expect(result.size).toBe(1);
    });

    it("should handle errors during document fetching", async () => {
      (getAllFiles as jest.Mock).mockRejectedValue(new Error("File system error"));

      const result = await repository.getDocuments("subdir");

      expect(result.size).toBe(0);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Error listing files"));
    });
  });

  describe("getDirectoryHash", () => {
    it("should return 'no-content' when directory does not exist", async () => {
      (mockFs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      repository = new LocalDocumentRepository("/nonexistent");

      const hash = await repository.getDirectoryHash("subdir");

      expect(hash).toBe("no-content");
    });

    it("should return null when subdirectory does not exist", async () => {
      repository = new LocalDocumentRepository("/test/dir");
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      const hash = await repository.getDirectoryHash("missing");

      expect(hash).toBeNull();
      expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("does not exist yet"));
    });

    it("should calculate hash based on file modification times", async () => {
      repository = new LocalDocumentRepository("/test/dir");
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockResolvedValue(["/test/dir/subdir/file1.json", "/test/dir/subdir/file2.json"]);
      (mockFs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 123456789 });

      const hash = await repository.getDirectoryHash("subdir");

      expect(hash).not.toBeNull();
      expect(typeof hash).toBe("string");
      expect(hash?.length).toBe(64); // SHA-256 hash length
    });

    it("should handle errors during hash calculation", async () => {
      repository = new LocalDocumentRepository("/test/dir");
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (getAllFiles as jest.Mock).mockRejectedValue(new Error("Cannot read directory"));

      const hash = await repository.getDirectoryHash("subdir");

      expect(hash).toBeNull();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Error calculating hash"));
    });
  });

  describe("listFiles", () => {
    it("should return empty array when directory does not exist", async () => {
      (mockFs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      repository = new LocalDocumentRepository("/nonexistent");

      const files = await repository.listFiles("subdir");

      expect(files).toEqual([]);
    });

    it("should list all files in directory", async () => {
      repository = new LocalDocumentRepository("/test/dir");
      (getAllFiles as jest.Mock).mockResolvedValue(["/test/dir/subdir/file1.json", "/test/dir/subdir/file2.json"]);

      const files = await repository.listFiles("subdir");

      expect(files).toEqual(["subdir/file1.json", "subdir/file2.json"]);
    });

    it("should handle errors during file listing", async () => {
      repository = new LocalDocumentRepository("/test/dir");
      (getAllFiles as jest.Mock).mockRejectedValue(new Error("Permission denied"));

      const files = await repository.listFiles("subdir");

      expect(files).toEqual([]);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Error listing files"));
    });
  });

  describe("getFileContent", () => {
    beforeEach(() => {
      repository = new LocalDocumentRepository("/test/dir");
    });

    it("should return file content when file exists", async () => {
      const content = "test file content";
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(Buffer.from(content));

      const result = await repository.getFileContent("file.txt");

      expect(result).toEqual(Buffer.from(content));
    });

    it("should return null when file does not exist", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await repository.getFileContent("missing.txt");

      expect(result).toBeNull();
    });

    it("should handle errors during file read", async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error("Read error");
      });

      const result = await repository.getFileContent("file.txt");

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Error reading local file content"));
    });
  });
});
