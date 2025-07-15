import * as fs from "fs/promises";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import { ContentFetcher, ContentFetchProgress, ContentMetadata } from "./interfaces/contentFetcher.js";
import { GithubConfig } from "../model/github.js";
import pLimit from "p-limit";

export class GithubContentFetcher implements ContentFetcher {
  private readonly octokit: Octokit;
  private readonly config: GithubConfig;
  private abortController: AbortController | null = null;
  private readonly limit = pLimit(5); // Limit concurrent requests to avoid rate limiting
  private currentCommitHash: string | null = null;

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

    try {
      // Get the tree of all files
      const tree = await this.getCompleteTree();
      progress.totalFiles = tree.length;

      // Create directory structure
      await this.createDirectoryStructure(targetDir, tree);

      // Download all files
      await this.downloadFiles(targetDir, tree, progress, onProgress);

      if (progress.errors.length > 0) {
        throw new Error(`Failed to fetch ${progress.errors.length} files`);
      }

      // Return metadata
      return {
        commitHash: this.currentCommitHash!,
        fetchTime: new Date(),
        branch: this.config.branch,
        repository: `${this.config.owner}/${this.config.repo}`,
        totalFiles: progress.totalFiles,
      };
    } catch (error) {
      if (this.abortController.signal.aborted) {
        throw new Error("Fetch aborted");
      }
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

  private async getCompleteTree(): Promise<{ path: string; sha: string; size: number; type: string }[]> {
    const { data } = await this.octokit.repos.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: this.config.branch,
    });

    // Store the commit hash for metadata
    this.currentCommitHash = data.sha;

    const treeSha = data.commit.tree.sha;

    const { data: treeData } = await this.octokit.git.getTree({
      owner: this.config.owner,
      repo: this.config.repo,
      tree_sha: treeSha,
      recursive: "true",
    });

    // Filter to only include files within the rootDirectory
    return (
      treeData.tree
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((item: any) => item.type === "blob" && item.path?.startsWith(this.config.rootDirectory))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => ({
          path: item.path!.substring(this.config.rootDirectory.length).replace(/^\//, ""),
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

          await fs.writeFile(filePath, content);

          progress.fetchedFiles++;
          onProgress?.(progress);
        } catch (error) {
          progress.errors.push(`Failed to fetch ${item.path}: ${error}`);
        }
      }),
    );

    await Promise.all(tasks);
  }
}
