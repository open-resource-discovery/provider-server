import * as fs from "fs/promises";
import * as path from "path";
import { ContentMetadata } from "./interfaces/contentFetcher.js";
import { log } from "../util/logger.js";

export interface FileSystemManagerConfig {
  dataDir: string;
  documentsSubDirectory: string;
}

export class FileSystemManager {
  private readonly dataDir: string;
  private readonly currentDir: string;
  private readonly tempDir: string;
  private readonly metadataFile: string;
  private readonly documentsSubDirectory: string;
  private readonly isWindows: boolean = process.platform === "win32";

  public constructor(config: FileSystemManagerConfig) {
    this.dataDir = config.dataDir;
    this.currentDir = path.join(this.dataDir, "current");
    this.tempDir = path.join(this.dataDir, "temp");
    this.metadataFile = path.join(this.dataDir, ".metadata.json");
    this.documentsSubDirectory = config.documentsSubDirectory;
  }

  public async initialize(): Promise<void> {
    // Create directory structure
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.currentDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });

    // Create documents subdirectory in current directory
    const documentsPath = path.join(this.currentDir, this.documentsSubDirectory);
    await fs.mkdir(documentsPath, { recursive: true });
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

    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });

    // Return the temp directory itself, not a subdirectory
    return this.tempDir;
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  public async swapDirectories(tempDir: string): Promise<void> {
    log.info(`Starting directory swap: ${tempDir} -> ${this.currentDir}`);

    try {
      // On Windows, use copy approach to avoid EPERM errors
      if (this.isWindows) {
        log.debug("Using copy approach for Windows");

        // Backup current directory if it exists
        const backupDir = path.join(this.dataDir, `backup_${Date.now()}`);
        if (await this.hasCurrentContent()) {
          log.info("Creating backup of current directory");
          await this.copyDirectory(this.currentDir, backupDir);
        }

        try {
          // Remove current directory
          if (await this.hasCurrentContent()) {
            await fs.rm(this.currentDir, { recursive: true, force: true });
          }

          // Copy temp to current
          log.info("Copying temp directory to current");
          await this.copyDirectory(tempDir, this.currentDir);

          // Clean up temp directory
          await fs.rm(tempDir, { recursive: true, force: true });

          // Clean up backup if it exists
          try {
            await fs.access(backupDir);
            await fs.rm(backupDir, { recursive: true, force: true });
          } catch {
            // Backup doesn't exist, that's fine
          }
        } catch (error) {
          // Try to restore backup
          try {
            await fs.access(backupDir);
            log.error("Copy failed, restoring backup");
            await fs.rm(this.currentDir, { recursive: true, force: true }).catch(() => {});
            await this.copyDirectory(backupDir, this.currentDir);
          } catch (restoreError) {
            log.error(`Failed to restore backup: ${restoreError}`);
          }
          throw error;
        }
      } else {
        // On non-Windows systems, use rename for atomic operation
        const backupDir = path.join(this.dataDir, `backup_${Date.now()}`);

        if (await this.hasCurrentContent()) {
          await fs.rename(this.currentDir, backupDir);
        }

        await fs.rename(tempDir, this.currentDir);

        try {
          await fs.access(backupDir);
          await fs.rm(backupDir, { recursive: true, force: true });
        } catch {
          // No backup to clean
        }
      }

      log.info("Directory swap completed successfully");
    } catch (error) {
      log.error(`Directory swap failed: ${error}`);
      throw error;
    }
  }

  public async cleanupTempDirectory(): Promise<void> {
    try {
      // Remove the entire temp directory and recreate it
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup - directory might not exist
    }

    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  public async validateContent(directory: string): Promise<boolean> {
    try {
      const stats = await fs.stat(directory);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check for required documents directory
      const documentsPath = path.join(directory, this.documentsSubDirectory);
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
