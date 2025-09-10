import * as fs from "fs/promises";
import * as path from "path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { ContentFetcher, ContentFetchProgress, ContentMetadata } from "./interfaces/contentFetcher.js";
import { GithubConfig } from "../model/github.js";
import { log } from "../util/logger.js";
import { GitHubNetworkError } from "../model/error/GithubErrors.js";
import { DiskSpaceError } from "../model/error/SystemErrors.js";
import { GitWorkerManager } from "./gitWorkerManager.js";

export class GitCloneContentFetcher implements ContentFetcher {
  private readonly config: GithubConfig;
  private abortController: AbortController | null = null;
  private currentCommitHash: string | null = null;
  private readonly gitWorker: GitWorkerManager;

  public constructor(config: GithubConfig) {
    this.config = config;
    this.gitWorker = new GitWorkerManager();
  }

  public async fetchAllContent(
    targetDir: string,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<ContentMetadata> {
    this.abortController = new AbortController();

    const progress: ContentFetchProgress = {
      totalFiles: 0,
      fetchedFiles: 0,
      startTime: new Date(),
      errors: [],
    };

    log.info(`Starting git clone/pull from ${this.config.owner}/${this.config.repo} (branch: ${this.config.branch})`);

    try {
      const gitUrl = this.buildGitUrl();
      const gitDir = path.join(targetDir, ".git");
      const isExistingRepo = await this.pathExists(gitDir);

      if (isExistingRepo) {
        // Repository exists, do a pull
        await this.gitPull(targetDir, gitUrl, progress, onProgress);
      } else {
        // Fresh clone
        await this.gitClone(gitUrl, targetDir, progress, onProgress);
      }

      // Get commit hash
      this.currentCommitHash = await this.getCurrentCommitHash(targetDir);

      // Count files
      const fileCount = await this.countFiles(targetDir);
      progress.totalFiles = fileCount;
      progress.fetchedFiles = fileCount;

      const duration = (new Date().getTime() - progress.startTime.getTime()) / 1000;
      log.debug(`Git clone/pull completed successfully in ${duration.toFixed(2)}s - ${fileCount} files`);

      // Return metadata
      return {
        commitHash: this.currentCommitHash,
        fetchTime: new Date(),
        branch: this.config.branch,
        repository: `${this.config.owner}/${this.config.repo}`,
        totalFiles: fileCount,
      };
    } catch (error) {
      if (this.abortController.signal.aborted) {
        log.warn("Git clone/pull was aborted");
        throw new Error("Fetch aborted");
      }

      if (error instanceof Error) {
        if (
          error.message.includes("Could not resolve host") ||
          error.message.includes("Connection refused") ||
          error.message.includes("Network is unreachable") ||
          error.message.includes("ENOTFOUND")
        ) {
          log.error(error, "No connection to GitHub");
          const gitUrl = this.buildGitUrl();
          throw GitHubNetworkError.fromError(error, gitUrl);
        }

        if (error.message.includes("No space left on device") || error.message.includes("ENOSPC")) {
          throw DiskSpaceError.fromError(error, targetDir);
        }
      }

      log.error(error, "Git clone/pull failed:", error);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  public async fetchLatestChanges(targetDir: string, _since?: Date): Promise<ContentMetadata> {
    // Use git pull for incremental updates
    return await this.fetchAllContent(targetDir);
  }

  public abortFetch(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    // Also abort any ongoing git operations in the worker
    this.gitWorker.abort();
  }

  public async getLatestCommitSha(): Promise<string> {
    const gitUrl = this.buildGitUrl();
    try {
      // Use isomorphic-git to get remote info
      const info = await git.getRemoteInfo({
        url: gitUrl,
        http,
        onAuth: this.getAuthCallback(),
      });

      if (info.refs && info.refs.heads && info.refs.heads[this.config.branch]) {
        return info.refs.heads[this.config.branch];
      }

      throw new Error(`Branch ${this.config.branch} not found in remote repository`);
    } catch (error) {
      log.error(`Failed to get latest commit SHA: ${error}`);
      throw error;
    }
  }

  public getDirectoryTreeSha(_commitSha?: string): Promise<string | null> {
    // Git clone doesn't provide tree SHA in the same way as the API
    // Return null or implement if needed
    return Promise.resolve(null);
  }

  private buildGitUrl(): string {
    // Parse the API URL to get the host
    const apiUrl = new URL(this.config.apiUrl);
    const isGitHubCom = apiUrl.hostname === "api.github.com";

    if (isGitHubCom) {
      // For github.com, use standard URL
      return `https://github.com/${this.config.owner}/${this.config.repo}.git`;
    } else {
      // For GitHub Enterprise, derive git URL from API URL
      // API URL format: https://github.enterprise.com/api/v3
      // Git URL format: https://github.enterprise.com/owner/repo.git

      // Remove /api/v3 or /api from the hostname
      const gitHost = apiUrl.origin.replace(/\/api\/v\d+$/, "").replace(/\/api$/, "");
      return `${gitHost}/${this.config.owner}/${this.config.repo}.git`;
    }
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.config.token) {
      return {};
    }

    // For GitHub token authentication (used for non-git operations)
    return {
      Authorization: `token ${this.config.token}`,
    };
  }

  private getAuthCallback(): (() => { username: string; password: string }) | undefined {
    if (!this.config.token) {
      return undefined;
    }

    // GitHub (including Enterprise) accepts tokens as Basic Auth with:
    // - Username: the token itself
    // - Password: 'x-oauth-basic' (GitHub's convention)
    return () => ({
      username: this.config.token!,
      password: "x-oauth-basic",
    });
  }

  private async gitClone(
    gitUrl: string,
    targetDir: string,
    progress: ContentFetchProgress,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<void> {
    log.debug(`Cloning repository from ${gitUrl} to ${targetDir}`);
    progress.currentFile = "Initializing git clone...";
    onProgress?.(progress);

    try {
      // Ensure target directory exists
      await fs.mkdir(targetDir, { recursive: true });

      // Clone the repository using worker thread
      await this.gitWorker.clone(
        gitUrl,
        targetDir,
        this.config.branch,
        this.getAuthCallback() ? { username: this.config.token!, password: "x-oauth-basic" } : undefined,
        (progressEvent) => {
          let message = "";
          const phase = progressEvent.phase;
          const loaded = progressEvent.loaded || 0;
          const total = progressEvent.total || 0;

          // Handle different git phases with detailed messages
          if (phase === "Counting objects") {
            message = `Counting objects: ${loaded}`;
          } else if (phase === "Receiving objects") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Receiving objects: ${loaded}/${total} (${percentage}%)`;
            // Update file counts based on objects
            if (total > 0 && progress.totalFiles === 0) {
              progress.totalFiles = total;
            }
            progress.fetchedFiles = loaded;
          } else if (phase === "Resolving deltas") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Resolving deltas: ${loaded}/${total} (${percentage}%)`;
          } else if (phase === "Downloading objects") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Downloading objects: ${loaded}/${total} (${percentage}%)`;
            // Update progress counts
            if (total > 0 && progress.totalFiles === 0) {
              progress.totalFiles = total;
            }
            progress.fetchedFiles = loaded;
          } else if (phase === "Checking out files") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Checking out files: ${loaded}/${total} (${percentage}%)`;
          } else {
            message = "Processing...";
          }

          progress.currentFile = message;
          onProgress?.(progress);
        },
      );

      // If we need a specific directory (sparse checkout equivalent)
      if (this.config.rootDirectory !== ".") {
        log.debug(`Extracting content from rootDirectory: ${this.config.rootDirectory}`);
        progress.currentFile = `Extracting ${this.config.rootDirectory}...`;
        onProgress?.(progress);
        await this.extractRootDirectory(targetDir, progress, onProgress);
      }

      progress.currentFile = "Clone completed";
      onProgress?.(progress);
    } catch (error) {
      progress.errors.push(`Failed to clone repository: ${error}`);
      throw error;
    }
  }

  private async gitPull(
    targetDir: string,
    _gitUrl: string,
    progress: ContentFetchProgress,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<void> {
    log.debug(`Pulling latest changes in ${targetDir}`);
    progress.currentFile = "Checking for updates...";
    onProgress?.(progress);

    try {
      progress.currentFile = "Fetching latest changes from remote...";
      onProgress?.(progress);

      await this.gitWorker.fetch(
        targetDir,
        this.config.branch,
        this.getAuthCallback() ? { username: this.config.token!, password: "x-oauth-basic" } : undefined,
      );

      onProgress?.(progress);

      await this.gitWorker.merge(targetDir, this.config.branch, `origin/${this.config.branch}`);

      progress.currentFile = "Pull completed";
      onProgress?.(progress);

      // After pull, extract rootDirectory if needed
      if (this.config.rootDirectory !== ".") {
        log.debug(`Re-extracting content from rootDirectory: ${this.config.rootDirectory}`);
        progress.currentFile = `Extracting ${this.config.rootDirectory}...`;
        onProgress?.(progress);
        await this.extractRootDirectory(targetDir, progress, onProgress);
      }
    } catch (error) {
      // If merge fails, try reset --hard
      log.warn(`Merge failed, attempting hard reset: ${error}`);

      progress.currentFile = "Performing hard reset...";
      onProgress?.(progress);

      await this.gitWorker.checkout(targetDir, `origin/${this.config.branch}`, true);

      progress.currentFile = "Reset completed";
      onProgress?.(progress);

      // After reset, extract rootDirectory if needed
      if (this.config.rootDirectory !== ".") {
        log.debug(`Re-extracting content from rootDirectory after reset: ${this.config.rootDirectory}`);
        progress.currentFile = `Extracting ${this.config.rootDirectory}...`;
        onProgress?.(progress);
        await this.extractRootDirectory(targetDir, progress, onProgress);
      }
    }
  }

  private async getCurrentCommitHash(targetDir: string): Promise<string> {
    try {
      const commitOid = await git.resolveRef({
        fs,
        dir: targetDir,
        ref: "HEAD",
      });
      return commitOid;
    } catch (error) {
      log.error(`Failed to get current commit hash: ${error}`);
      throw error;
    }
  }

  private async countFiles(targetDir: string): Promise<number> {
    try {
      // Use isomorphic-git to list files
      const files = await git.listFiles({
        fs,
        dir: targetDir,
        ref: "HEAD",
      });

      // Filter files based on root directory if needed
      if (this.config.rootDirectory !== ".") {
        const filtered = files.filter((file) => file.startsWith(this.config.rootDirectory));
        return filtered.length;
      }

      return files.length;
    } catch (error) {
      log.warn(`Failed to count files using git, falling back to filesystem: ${error}`);
      // Fallback to counting files in the filesystem
      return await this.countFilesInDirectory(targetDir);
    }
  }

  private async countFilesInDirectory(dir: string): Promise<number> {
    let count = 0;
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name === ".git") continue; // Skip .git directory

      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        count += await this.countFilesInDirectory(fullPath);
      } else if (item.isFile()) {
        count++;
      }
    }

    return count;
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async extractRootDirectory(
    targetDir: string,
    progress?: ContentFetchProgress,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<void> {
    const sourcePath = path.join(targetDir, this.config.rootDirectory);

    // Check if the source path exists
    if (!(await this.pathExists(sourcePath))) {
      throw new Error(`Root directory '${this.config.rootDirectory}' not found in repository`);
    }

    // Create a staging directory
    const stagingDir = `${targetDir}_staging`;

    try {
      // Copy (not move) only the content from rootDirectory to staging
      if (progress && onProgress) {
        onProgress(progress);
      }
      await fs.cp(sourcePath, stagingDir, { recursive: true });

      // Remove everything from target except .git
      if (progress && onProgress) {
        onProgress(progress);
      }
      const items = await fs.readdir(targetDir);
      for (const item of items) {
        if (item !== ".git") {
          await fs.rm(path.join(targetDir, item), { recursive: true, force: true });
        }
      }

      // Move content from staging to target (alongside .git)
      if (progress && onProgress) {
        onProgress(progress);
      }
      const stagingItems = await fs.readdir(stagingDir);
      for (const item of stagingItems) {
        await fs.rename(path.join(stagingDir, item), path.join(targetDir, item));
      }

      // Clean up the staging directory
      if (progress && onProgress) {
        onProgress(progress);
      }
      await fs.rm(stagingDir, { recursive: true, force: true });

      log.debug(`Successfully extracted ${this.config.rootDirectory} to ${targetDir}`);
    } catch (error) {
      // Try to clean up staging if it exists
      try {
        await fs.rm(stagingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to extract root directory: ${error}`);
    }
  }

  public destroy(): void {
    // Clean up the worker thread
    this.gitWorker.destroy();
  }
}
