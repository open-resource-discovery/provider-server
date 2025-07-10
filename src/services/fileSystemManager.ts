import * as fs from "fs/promises";
import * as path from "path";
import { ContentMetadata } from "./interfaces/contentFetcher.js";

export interface FileSystemManagerConfig {
  dataDir: string;
}

export class FileSystemManager {
  private readonly dataDir: string;
  private readonly currentDir: string;
  private readonly tempDir: string;
  private readonly metadataFile: string;

  public constructor(config: FileSystemManagerConfig) {
    this.dataDir = config.dataDir;
    this.currentDir = path.join(this.dataDir, "current");
    this.tempDir = path.join(this.dataDir, "temp");
    this.metadataFile = path.join(this.dataDir, ".metadata.json");
  }

  public async initialize(): Promise<void> {
    // Create directory structure
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.currentDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  public async hasCurrentContent(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.currentDir);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check if directory has any content
      const contents = await fs.readdir(this.currentDir);
      return contents.length > 0;
    } catch {
      return false;
    }
  }

  public async getTempDirectory(): Promise<string> {
    // Clean temp directory first
    await this.cleanupTempDirectory();

    // Create a unique temp subdirectory for this update
    const tempUpdateDir = path.join(this.tempDir, `update_${Date.now()}`);
    await fs.mkdir(tempUpdateDir, { recursive: true });
    return tempUpdateDir;
  }

  public async swapDirectories(tempDir: string): Promise<void> {
    // Create a backup directory name
    const backupDir = path.join(this.dataDir, `backup_${Date.now()}`);

    try {
      // Move current to backup (if it exists and has content)
      if (await this.hasCurrentContent()) {
        await fs.rename(this.currentDir, backupDir);
      }

      // Move temp to current
      await fs.rename(tempDir, this.currentDir);

      // Remove backup after successful swap
      if (
        await fs
          .access(backupDir)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.rm(backupDir, { recursive: true, force: true });
      }
    } catch (error) {
      // If swap failed, try to restore backup
      if (
        await fs
          .access(backupDir)
          .then(() => true)
          .catch(() => false)
      ) {
        try {
          await fs.rename(backupDir, this.currentDir);
        } catch (restoreError) {
          throw new Error(`Failed to swap directories and restore backup: ${restoreError}`);
        }
      }
      throw error;
    }
  }

  public async cleanupTempDirectory(): Promise<void> {
    try {
      const tempContents = await fs.readdir(this.tempDir);

      for (const item of tempContents) {
        const itemPath = path.join(this.tempDir, item);
        await fs.rm(itemPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  public async validateContent(directory: string): Promise<boolean> {
    try {
      const stats = await fs.stat(directory);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check for required documents directory
      const documentsPath = path.join(directory, "documents");
      const documentsStats = await fs.stat(documentsPath);

      return documentsStats.isDirectory();
    } catch {
      return false;
    }
  }

  public getCurrentPath(): string {
    return this.currentDir;
  }

  public async getCurrentVersion(): Promise<string | null> {
    // In single version mode, we just check if current directory has content
    const hasContent = await this.hasCurrentContent();
    if (!hasContent) {
      return null;
    }

    // Try to read metadata to get commit hash
    const metadata = await this.getMetadata();
    return metadata?.commitHash || "current";
  }

  public async saveMetadata(metadata: ContentMetadata): Promise<void> {
    try {
      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2), "utf8");
    } catch {
      // Ignore error - metadata is nice to have but not critical
    }
  }

  public async getMetadata(): Promise<ContentMetadata | null> {
    try {
      const content = await fs.readFile(this.metadataFile, "utf8");
      const metadata = JSON.parse(content);
      // Convert fetchTime string back to Date
      metadata.fetchTime = new Date(metadata.fetchTime);
      return metadata;
    } catch {
      return null;
    }
  }
}
