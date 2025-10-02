import * as fs from "fs/promises";
import * as path from "path";
import { FileSystemManager } from "../fileSystemManager.js";
import { ContentMetadata } from "../interfaces/contentFetcher.js";
import { log } from "../../util/logger.js";

jest.mock("../../util/logger.js");

describe("FileSystemManager", () => {
  let fsManager: FileSystemManager;
  const testDataDir = "./test-data-dir";

  beforeEach(async () => {
    // Clean up test directory if it exists
    await fs.rm(testDataDir, { recursive: true, force: true });

    fsManager = new FileSystemManager({
      dataDir: testDataDir,
      documentsSubDirectory: "documents",
    });
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe("initialize", () => {
    it("should create directory structure", async () => {
      await fsManager.initialize();

      const dataDirExists = await fs
        .access(testDataDir)
        .then(() => true)
        .catch(() => false);
      const currentDirExists = await fs
        .access(path.join(testDataDir, "current"))
        .then(() => true)
        .catch(() => false);
      const tempDirExists = await fs
        .access(path.join(testDataDir, "temp"))
        .then(() => true)
        .catch(() => false);
      const documentsDirExists = await fs
        .access(path.join(testDataDir, "current", "documents"))
        .then(() => true)
        .catch(() => false);

      expect(dataDirExists).toBe(true);
      expect(currentDirExists).toBe(true);
      expect(tempDirExists).toBe(true);
      expect(documentsDirExists).toBe(true);
    });
  });

  describe("content management", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should return null when no current content exists", async () => {
      const currentVersion = await fsManager.getCurrentVersion();
      expect(currentVersion).toBeNull();
    });

    it("should return 'current' when content exists", async () => {
      const currentDir = path.join(testDataDir, "current");
      await fs.writeFile(path.join(currentDir, "test.txt"), "test content");

      const currentVersion = await fsManager.getCurrentVersion();
      expect(currentVersion).toBe("current");
    });

    it("should validate content with documents directory", async () => {
      const tempDir = await fsManager.getTempDirectory();

      // Create documents directory
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });

      const isValid = await fsManager.validateContent(tempDir);
      expect(isValid).toBe(true);
    });

    it("should fail validation without documents directory", async () => {
      const tempDir = await fsManager.getTempDirectory();

      const isValid = await fsManager.validateContent(tempDir);
      expect(isValid).toBe(false);
    });

    it("should swap directories atomically", async () => {
      // Create initial content
      const currentDir = path.join(testDataDir, "current");
      await fs.mkdir(path.join(currentDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(currentDir, "test.txt"), "old content");

      // Create new content in temp
      const tempDir = await fsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "test.txt"), "new content");

      // Swap directories
      await fsManager.swapDirectories(tempDir);

      // Verify new content is in current
      const content = await fs.readFile(path.join(currentDir, "test.txt"), "utf8");
      expect(content).toBe("new content");
    });
  });

  describe("cleanup operations", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should cleanup temp directory", async () => {
      const tempDir = await fsManager.getTempDirectory();
      await fs.writeFile(path.join(tempDir, "test.txt"), "test content");

      await fsManager.cleanupTempDirectory();

      const tempContents = await fs.readdir(path.join(testDataDir, "temp"));
      expect(tempContents.length).toBe(0);
    });
  });

  describe("path operations", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should return correct current path", () => {
      const currentPath = fsManager.getCurrentPath();
      expect(currentPath).toBe(path.join(testDataDir, "current"));
    });
  });

  describe("metadata operations", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should save and retrieve metadata", async () => {
      const metadata: ContentMetadata = {
        commitHash: "abc123",
        fetchTime: new Date("2024-01-01T00:00:00Z"),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 10,
      };

      await fsManager.saveMetadata(metadata);
      const retrieved = await fsManager.getMetadata();

      expect(retrieved).toEqual(metadata);
      expect(retrieved?.fetchTime).toBeInstanceOf(Date);
    });

    it("should return null when metadata doesn't exist", async () => {
      const metadata = await fsManager.getMetadata();
      expect(metadata).toBeNull();
    });

    it("should return commit hash from metadata", async () => {
      const metadata: ContentMetadata = {
        commitHash: "def456",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 5,
      };

      await fsManager.saveMetadata(metadata);

      // Create some content so hasCurrentContent returns true
      const currentDir = path.join(testDataDir, "current");
      await fs.writeFile(path.join(currentDir, "test.txt"), "content");

      const version = await fsManager.getCurrentVersion();
      expect(version).toBe("def456");
    });

    it("should handle metadata save errors gracefully", async () => {
      // Create a read-only metadata file to cause write error
      const metadataPath = path.join(testDataDir, ".metadata.json");
      await fs.writeFile(metadataPath, "existing");
      await fs.chmod(metadataPath, 0o444);

      const metadata: ContentMetadata = {
        commitHash: "abc123",
        fetchTime: new Date(),
        branch: "main",
        repository: "owner/repo",
        totalFiles: 10,
      };

      // Should not throw
      await expect(fsManager.saveMetadata(metadata)).resolves.not.toThrow();

      // Restore permissions for cleanup
      await fs.chmod(metadataPath, 0o644);
    });

    it("should handle corrupted metadata gracefully", async () => {
      const metadataPath = path.join(testDataDir, ".metadata.json");
      await fs.writeFile(metadataPath, "{ invalid json }");

      const metadata = await fsManager.getMetadata();
      expect(metadata).toBeNull();
    });
  });

  describe("hasCurrentContent", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should return false when current is not a directory", async () => {
      const currentPath = path.join(testDataDir, "current");
      await fs.rm(currentPath, { recursive: true });
      await fs.writeFile(currentPath, "not a directory");

      const hasContent = await fsManager.hasCurrentContent();
      expect(hasContent).toBe(false);
    });

    it("should return false when current directory doesn't exist", async () => {
      const currentPath = path.join(testDataDir, "current");
      await fs.rm(currentPath, { recursive: true });

      const hasContent = await fsManager.hasCurrentContent();
      expect(hasContent).toBe(false);
    });

    it("should return false when current directory is empty", async () => {
      const hasContent = await fsManager.hasCurrentContent();
      expect(hasContent).toBe(false);
    });

    it("should return true when current directory has content", async () => {
      const currentPath = path.join(testDataDir, "current");
      await fs.writeFile(path.join(currentPath, "file.txt"), "content");

      const hasContent = await fsManager.hasCurrentContent();
      expect(hasContent).toBe(true);
    });
  });

  describe("validateContent", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should return false when path is not a directory", async () => {
      const filePath = path.join(testDataDir, "file.txt");
      await fs.writeFile(filePath, "not a directory");

      const isValid = await fsManager.validateContent(filePath);
      expect(isValid).toBe(false);
    });

    it("should return false when path doesn't exist", async () => {
      const isValid = await fsManager.validateContent("/non/existent/path");
      expect(isValid).toBe(false);
    });

    it("should return false when documents is not a directory", async () => {
      const tempDir = await fsManager.getTempDirectory();
      await fs.writeFile(path.join(tempDir, "documents"), "not a directory");

      const isValid = await fsManager.validateContent(tempDir);
      expect(isValid).toBe(false);
    });
  });

  describe("Windows-specific directory swap", () => {
    let originalPlatform: PropertyDescriptor | undefined;

    beforeEach(async () => {
      await fsManager.initialize();
      originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    });

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    });

    it("should use copy approach on Windows", async () => {
      // Mock Windows platform
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const winFsManager = new FileSystemManager({
        dataDir: testDataDir,
        documentsSubDirectory: "documents",
      });

      // Create initial content
      const currentDir = path.join(testDataDir, "current");
      await fs.mkdir(path.join(currentDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(currentDir, "old.txt"), "old content");

      // Create new content in temp
      const tempDir = await winFsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "new.txt"), "new content");

      // Swap directories
      await winFsManager.swapDirectories(tempDir);

      // Verify new content is in current
      const newContent = await fs.readFile(path.join(currentDir, "new.txt"), "utf8");
      expect(newContent).toBe("new content");

      // Old content should be gone
      await expect(fs.access(path.join(currentDir, "old.txt"))).rejects.toThrow();

      // Temp directory should be cleaned
      await expect(fs.access(tempDir)).rejects.toThrow();
    });

    it("should handle Windows swap errors and restore backup", async () => {
      // Mock Windows platform
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const winFsManager = new FileSystemManager({
        dataDir: testDataDir,
        documentsSubDirectory: "documents",
      });

      // Create initial content
      const currentDir = path.join(testDataDir, "current");
      await fs.mkdir(path.join(currentDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(currentDir, "original.txt"), "original content");

      // Create new content in temp
      const tempDir = await winFsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "new.txt"), "new content");

      // Mock copyDirectory to fail on the FileSystemManager instance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const copyDirectorySpy = jest.spyOn(winFsManager as any, "copyDirectory");
      let copyCallCount = 0;
      copyDirectorySpy.mockImplementation(() => {
        copyCallCount++;
        // Fail on the second call (copying temp to current)
        if (copyCallCount === 2) {
          throw new Error("Simulated copy failure");
        }
        // For the first call (backup), do nothing (it's already backed up)
        return Promise.resolve();
      });

      // Swap should fail
      await expect(winFsManager.swapDirectories(tempDir)).rejects.toThrow("Simulated copy failure");

      // Verify the appropriate error was logged
      expect(log.error).toHaveBeenCalledWith("Directory swap failed: Error: Simulated copy failure");

      // Restore original function
      copyDirectorySpy.mockRestore();
    });

    it("should handle Windows swap when no current content exists", async () => {
      // Mock Windows platform
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const winFsManager = new FileSystemManager({
        dataDir: testDataDir,
        documentsSubDirectory: "documents",
      });

      // Remove current directory
      const currentDir = path.join(testDataDir, "current");
      await fs.rm(currentDir, { recursive: true });

      // Create new content in temp
      const tempDir = await winFsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "new.txt"), "new content");

      // Swap directories
      await winFsManager.swapDirectories(tempDir);

      // Verify new content is in current
      const newContent = await fs.readFile(path.join(currentDir, "new.txt"), "utf8");
      expect(newContent).toBe("new content");
    });
  });

  describe("Non-Windows directory swap", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should use rename for atomic operation on non-Windows", async () => {
      // Create initial content
      const currentDir = path.join(testDataDir, "current");
      await fs.mkdir(path.join(currentDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(currentDir, "old.txt"), "old content");

      // Create new content in temp
      const tempDir = await fsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "new.txt"), "new content");

      // Swap directories (rename operations will work normally)
      await fsManager.swapDirectories(tempDir);

      // Verify new content is in current
      const newContent = await fs.readFile(path.join(currentDir, "new.txt"), "utf8");
      expect(newContent).toBe("new content");
    });

    it("should handle swap when no current content exists", async () => {
      // Remove current directory
      const currentDir = path.join(testDataDir, "current");
      await fs.rm(currentDir, { recursive: true });

      // Create new content in temp
      const tempDir = await fsManager.getTempDirectory();
      await fs.mkdir(path.join(tempDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "new.txt"), "new content");

      // Swap directories
      await fsManager.swapDirectories(tempDir);

      // Verify new content is in current
      const newContent = await fs.readFile(path.join(currentDir, "new.txt"), "utf8");
      expect(newContent).toBe("new content");
    });

    it("should handle swap errors", async () => {
      // Create initial content
      const currentDir = path.join(testDataDir, "current");
      await fs.mkdir(path.join(currentDir, "documents"), { recursive: true });
      await fs.writeFile(path.join(currentDir, "old.txt"), "old content");

      // Create a temp directory that doesn't exist (simulate rename failure)
      const nonExistentTempDir = path.join(testDataDir, "non-existent-temp");

      // Swap should fail because the temp directory doesn't exist
      await expect(fsManager.swapDirectories(nonExistentTempDir)).rejects.toThrow();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("cleanupTempDirectory edge cases", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should handle cleanup when temp directory doesn't exist", async () => {
      const tempPath = path.join(testDataDir, "temp");
      await fs.rm(tempPath, { recursive: true });

      // Should not throw
      await expect(fsManager.cleanupTempDirectory()).resolves.not.toThrow();

      // Temp directory should be recreated
      const exists = await fs
        .access(tempPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("getTempDirectory", () => {
    beforeEach(async () => {
      await fsManager.initialize();
    });

    it("should clean up existing temp content before returning", async () => {
      const tempPath = path.join(testDataDir, "temp");

      // Add some existing content
      await fs.writeFile(path.join(tempPath, "existing.txt"), "old temp content");

      // Get temp directory should clean it first
      const tempDir = await fsManager.getTempDirectory();

      // Verify old content is gone
      const contents = await fs.readdir(tempDir);
      expect(contents).toEqual([]);
      expect(tempDir).toBe(tempPath);
    });
  });
});
