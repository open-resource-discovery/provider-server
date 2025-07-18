import * as fs from "fs/promises";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import { ContentFetcher, ContentFetchProgress, ContentMetadata } from "./interfaces/contentFetcher.js";
import { GithubConfig } from "../model/github.js";
import pLimit from "p-limit";
import { log } from "../util/logger.js";
import { GitHubNetworkError } from "../model/error/GithubErrors.js";
import { DiskSpaceError, MemoryError } from "../model/error/SystemErrors.js";

export class GithubContentFetcher implements ContentFetcher {
  private readonly octokit: Octokit;
  private readonly config: GithubConfig;
  private abortController: AbortController | null = null;
  private readonly limit = pLimit(5); // Limit concurrent requests to avoid rate limiting
  private currentCommitHash: string | null = null;
  private currentDirectoryTreeSha: string | null = null;

  public constructor(config: GithubConfig) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.token,
      baseUrl: config.apiUrl,
    });
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

    log.info(
      `Starting GitHub content fetch from ${this.config.owner}/${this.config.repo} (branch: ${this.config.branch})`,
    );

    try {
      // Get the tree of all files
      const tree = await this.getCompleteTree();
      progress.totalFiles = tree.length;
      log.debug(`Found ${tree.length} files in repository`);

      // Create directory structure
      await this.createDirectoryStructure(targetDir, tree);

      // Download all files
      await this.downloadFiles(targetDir, tree, progress, onProgress);

      if (progress.errors.length > 0) {
        log.error(`Failed to fetch ${progress.errors.length} files:`);
        progress.errors.forEach((error, index) => {
          log.error(`  ${index + 1}. ${error}`);
        });
        throw new Error(`Failed to fetch ${progress.errors.length} files`);
      }

      const duration = (new Date().getTime() - progress.startTime.getTime()) / 1000;
      log.debug(
        `GitHub content fetch completed successfully in ${duration.toFixed(2)}s - ${progress.fetchedFiles} files downloaded`,
      );

      // Return metadata
      return {
        commitHash: this.currentCommitHash!,
        directoryTreeSha: this.currentDirectoryTreeSha || undefined,
        fetchTime: new Date(),
        branch: this.config.branch,
        repository: `${this.config.owner}/${this.config.repo}`,
        totalFiles: progress.totalFiles,
      };
    } catch (error) {
      if (this.abortController.signal.aborted) {
        log.warn("GitHub content fetch was aborted");
        throw new Error("Fetch aborted");
      }

      // Check for network/connection errors
      if (
        error instanceof Error &&
        (error.message.includes("ECONNREFUSED") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ETIMEDOUT") ||
          error.message.includes("getaddrinfo") ||
          error.message.includes("network"))
      ) {
        log.error(error, "No connection to GitHub API");
        throw GitHubNetworkError.fromError(error, this.config.apiUrl);
      }

      log.error(error, "GitHub content fetch failed:", error);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  public async fetchLatestChanges(targetDir: string, _since?: Date): Promise<ContentMetadata> {
    // For now, do a full fetch - can be optimized later to fetch only changed files
    return await this.fetchAllContent(targetDir);
  }

  public abortFetch(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  public async getLatestCommitSha(): Promise<string> {
    const { data } = await this.octokit.repos.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: this.config.branch,
    });

    return data.sha;
  }

  public async getDirectoryTreeSha(commitSha?: string): Promise<string | null> {
    try {
      // If no commit SHA provided, get the latest
      let commitToUse = commitSha;
      if (!commitToUse) {
        commitToUse = await this.getLatestCommitSha();
      }

      // Get the commit details to get the root tree SHA
      const { data: commitData } = await this.octokit.git.getCommit({
        owner: this.config.owner,
        repo: this.config.repo,
        commit_sha: commitToUse,
      });

      // If rootDirectory is ".", return the root tree SHA
      if (this.config.rootDirectory === ".") {
        return commitData.tree.sha;
      }

      // Get the full tree to find our specific directory
      const { data: treeData } = await this.octokit.git.getTree({
        owner: this.config.owner,
        repo: this.config.repo,
        tree_sha: commitData.tree.sha,
        recursive: "true",
      });

      // Find the tree entry for our root directory
      const normalizedPath = this.config.rootDirectory.replace(/\/$/, ""); // Remove trailing slash
      const directoryEntry = treeData.tree.find((item) => item.path === normalizedPath && item.type === "tree");

      if (!directoryEntry) {
        log.warn(`Directory ${this.config.rootDirectory} not found in repository tree`);
        return null;
      }

      return directoryEntry.sha!;
    } catch (error) {
      log.error(`Failed to get directory tree SHA: ${error}`);
      throw error;
    }
  }

  private async getCompleteTree(): Promise<{ path: string; sha: string; size: number; type: string }[]> {
    const { data } = await this.octokit.repos.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: this.config.branch,
    });

    // Store the commit hash for metadata
    this.currentCommitHash = data.sha;

    // Get the directory tree SHA for the root directory
    this.currentDirectoryTreeSha = await this.getDirectoryTreeSha(data.sha);

    const treeSha = data.commit.tree.sha;

    const { data: treeData } = await this.octokit.git.getTree({
      owner: this.config.owner,
      repo: this.config.repo,
      tree_sha: treeSha,
      recursive: "true",
    });

    // Filter to only include files within the rootDirectory
    const normalizedRootDir = this.config.rootDirectory.replace(/\/$/, "");
    const rootDirWithSeparator = normalizedRootDir === "." ? "" : normalizedRootDir + "/";

    return (
      treeData.tree
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((item: any) => {
          if (item.type !== "blob") return false;
          if (normalizedRootDir === ".") return true;
          // Check exact match or with path separator
          return item.path === normalizedRootDir || item.path?.startsWith(rootDirWithSeparator);
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => ({
          path: normalizedRootDir === "." ? item.path! : item.path!.substring(rootDirWithSeparator.length),
          sha: item.sha!,
          size: item.size || 0,
          type: item.type!,
        }))
    );
  }

  private async createDirectoryStructure(targetDir: string, tree: { path: string }[]): Promise<void> {
    const directories = new Set<string>();

    for (const item of tree) {
      const dir = path.dirname(item.path);
      if (dir !== ".") {
        directories.add(dir);
      }
    }

    for (const dir of Array.from(directories).sort()) {
      await fs.mkdir(path.join(targetDir, dir), { recursive: true });
    }
  }

  private async downloadFiles(
    targetDir: string,
    tree: { path: string; sha: string; size: number }[],
    progress: ContentFetchProgress,
    onProgress?: (progress: ContentFetchProgress) => void,
  ): Promise<void> {
    let lastLogTime = Date.now();
    const logInterval = 2000;

    const tasks = tree.map((item) =>
      this.limit(async () => {
        if (this.abortController?.signal.aborted) {
          throw new Error("Aborted");
        }

        try {
          progress.currentFile = item.path;

          // Use blobs API for all files
          const { data } = await this.octokit.git.getBlob({
            owner: this.config.owner,
            repo: this.config.repo,
            file_sha: item.sha,
          });

          const content = Buffer.from(data.content, data.encoding as BufferEncoding);
          const filePath = path.join(targetDir, item.path);

          try {
            await fs.writeFile(filePath, content);
          } catch (writeError) {
            // Check for specific system errors and rethrow with custom errors
            if (writeError instanceof Error) {
              if (writeError.message.includes("ENOSPC") || (writeError as NodeJS.ErrnoException).code === "ENOSPC") {
                throw DiskSpaceError.fromError(writeError, filePath);
              }
              if (writeError.message.includes("ENOMEM") || (writeError as NodeJS.ErrnoException).code === "ENOMEM") {
                throw MemoryError.fromError(writeError, filePath);
              }
            }
            throw writeError;
          }

          progress.fetchedFiles++;

          // Log progress periodically
          const now = Date.now();
          if (now - lastLogTime > logInterval) {
            const percentage = Math.round((progress.fetchedFiles / progress.totalFiles) * 100);
            log.debug(
              `Download progress: ${progress.fetchedFiles}/${progress.totalFiles} files (${percentage}%) - Current: ${item.path}`,
            );
            lastLogTime = now;
          }

          onProgress?.(progress);
        } catch (error) {
          log.warn(`Failed to fetch ${item.path}:`, error);
          progress.errors.push(`Failed to fetch ${item.path}: ${error}`);
          if (
            error instanceof DiskSpaceError ||
            error instanceof MemoryError ||
            error instanceof GithubContentFetcher
          ) {
            throw error;
          }
        }
      }),
    );

    await Promise.all(tasks);
  }
}
