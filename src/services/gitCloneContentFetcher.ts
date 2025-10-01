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

      let previousCommitHash: string | null = null;
      if (isExistingRepo) {
        try {
          previousCommitHash = await this.getCurrentCommitHash(targetDir);
        } catch {
          // Ignore error
        }
      }

      if (isExistingRepo) {
        // Repository exists, do a pull
        log.debug(
          `Updating existing repository from ${this.config.owner}/${this.config.repo} (branch: ${this.config.branch})`,
        );

        await this.gitPull(targetDir, progress, onProgress);
      } else {
        // Fresh clone
        log.debug(`Cloning repository from ${this.config.owner}/${this.config.repo} (branch: ${this.config.branch})`);
        await this.gitClone(gitUrl, targetDir, progress, onProgress);
      }

      // Get commit hash after update
      this.currentCommitHash = await this.getCurrentCommitHash(targetDir);

      const duration = (new Date().getTime() - progress.startTime.getTime()) / 1000;
      const operation = isExistingRepo ? "update" : "clone";

      if (isExistingRepo && previousCommitHash) {
        if (previousCommitHash === this.currentCommitHash) {
          log.debug(
            `Git ${operation} completed in ${duration.toFixed(2)}s - already up to date at ${this.currentCommitHash.substring(0, 7)}`,
          );
        } else {
          log.debug(
            `Git ${operation} completed in ${duration.toFixed(2)}s - updated from ${previousCommitHash.substring(0, 7)} to ${this.currentCommitHash.substring(0, 7)}`,
          );
        }
      } else {
        // For clone, count total files
        const fileCount = await this.countFiles(targetDir);
        progress.totalFiles = fileCount;
        progress.fetchedFiles = fileCount;
        log.debug(`Git ${operation} completed successfully in ${duration.toFixed(2)}s - ${fileCount} total files`);
      }

      const totalFiles = await this.countFiles(targetDir);
      progress.totalFiles = totalFiles;
      progress.fetchedFiles = totalFiles;

      const directoryTreeSha = await this.getDirectoryTreeSha(this.currentCommitHash);

      // Return metadata
      return {
        commitHash: this.currentCommitHash,
        directoryTreeSha: directoryTreeSha || undefined,
        fetchTime: new Date(),
        branch: this.config.branch,
        repository: `${this.config.owner}/${this.config.repo}`,
        totalFiles: totalFiles,
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

  public async getDirectoryTreeSha(commitSha?: string): Promise<string | null> {
    try {
      const sha = commitSha || (await this.getLatestCommitSha());

      // For git operations, we'll use the commit SHA combined with the rootDirectory
      // to create a unique identifier for change detection
      const dirIdentifier = `${sha}:${this.config.rootDirectory}`;

      log.debug(`Generated directory tree SHA: ${dirIdentifier}`);
      return dirIdentifier;
    } catch (error) {
      log.error(`Failed to get directory tree SHA: ${error}`);
      return null;
    }
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

          progress.phase = phase;

          if (phase === "Counting objects") {
            message = `Counting objects: ${loaded}`;
          } else if (phase === "Receiving objects") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Receiving objects: ${percentage}% (${loaded}/${total} git objects)`;
          } else if (phase === "Resolving deltas") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Resolving deltas: ${percentage}% (${loaded}/${total} git objects)`;
          } else if (phase === "Analyzing workdir" || phase === "Updating workdir") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `${phase}: ${percentage}% (${loaded}/${total} git objects)`;
          } else if (phase === "Downloading objects") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Downloading objects: ${percentage}% (${loaded}/${total} git objects)`;
          } else if (phase === "Checking out files") {
            const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
            message = `Checking out files: ${percentage}% (${loaded}/${total})`;
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
    progress: ContentFetchProgress,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<void> {
    log.debug(`Pulling latest changes in ${targetDir}`);
    progress.currentFile = "Pulling latest changes...";
    onProgress?.(progress);

    // Get current commit before pull
    const beforeCommit = await this.getCurrentCommitHash(targetDir);
    log.debug(`Current commit before pull: ${beforeCommit.substring(0, 7)}`);

    try {
      await this.gitWorker.pull(
        targetDir,
        this.config.branch,
        this.getAuthCallback() ? { username: this.config.token!, password: "x-oauth-basic" } : undefined,
      );
      log.debug("Successfully pulled changes");
    } catch (_pullError) {
      log.info(`Pull failed, resetting to origin/${this.config.branch}`);

      // First reset the index to clear any staged changes
      await this.gitWorker.resetIndex(targetDir);

      await this.gitWorker.checkout(targetDir, `origin/${this.config.branch}`, true);
    }

    // Get current commit after update
    const afterCommit = await this.getCurrentCommitHash(targetDir);

    if (beforeCommit !== afterCommit) {
      log.info(`Repository updated from ${beforeCommit.substring(0, 7)} to ${afterCommit.substring(0, 7)}`);
    }

    progress.currentFile = "Pull completed";
    onProgress?.(progress);

    // After pull, extract rootDirectory if needed
    if (this.config.rootDirectory !== ".") {
      log.debug(`Re-extracting content from rootDirectory: ${this.config.rootDirectory}`);
      progress.currentFile = `Extracting ${this.config.rootDirectory}...`;
      onProgress?.(progress);
      await this.extractRootDirectory(targetDir, progress, onProgress);
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
      const files = await git.listFiles({
        fs,
        dir: targetDir,
        ref: "HEAD",
      });

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
      if (item.name === ".git") continue;

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

    log.info(`Extracting root directory: ${this.config.rootDirectory} from ${targetDir}`);

    // Log git status before extraction to debug issues
    try {
      const status = await git.statusMatrix({
        fs,
        dir: targetDir,
      });
      const modifiedFiles = status.filter(([, , worktreeStatus]) => worktreeStatus !== 1);
      log.debug(`Git status before extraction - modified files: ${modifiedFiles.length}`);
      if (modifiedFiles.length > 0) {
        log.warn(`Warning: ${modifiedFiles.length} modified files detected before extraction`);
        modifiedFiles.slice(0, 5).forEach(([filepath]) => {
          log.debug(`  Modified: ${filepath}`);
        });
      }
    } catch (statusError) {
      log.debug(`Could not check git status: ${statusError}`);
    }

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
      try {
        await fs.rm(stagingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to extract root directory: ${error}`);
    }
  }

  public destroy(): void {
    this.gitWorker.destroy();
  }
}
