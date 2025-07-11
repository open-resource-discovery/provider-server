import * as fs from "fs/promises";
import * as path from "path";
import { FileSystemManager } from "../fileSystemManager.js";

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

      expect(dataDirExists).toBe(true);
      expect(currentDirExists).toBe(true);
      expect(tempDirExists).toBe(true);
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
});
