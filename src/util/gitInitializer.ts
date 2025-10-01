import * as fsPromises from "fs/promises";
import { ProviderServerOptions } from "src/model/server.js";
import { BackendError } from "../model/error/BackendError.js";
import { ValidationError } from "../model/error/ValidationError.js";
import { log } from "./logger.js";
import { GitCloneContentFetcher } from "../services/gitCloneContentFetcher.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { buildGithubConfig } from "../model/github.js";
import { createProgressHandler } from "./progressHandler.js";
import { UpdateStateManager } from "../services/updateStateManager.js";
import { validateGitContent } from "./validateGit.js";

/**
 * Initializes git source by checking, cloning, and validating git repository content
 * This function orchestrates the entire git initialization flow:
 * 1. Checks existing metadata and version
 * 2. Compares with remote to determine if update needed
 * 3. Performs clone/pull if needed
 * 4. Validates the cloned content
 * 5. Swaps directories if validation passes
 * 6. Saves metadata
 *
 * @param options Provider server options
 * @param fileSystemManager File system manager instance
 * @param stateManager Optional update state manager for progress tracking
 * @returns Content availability status and version
 * @throws ValidationError if initialization fails
 */
export async function initializeGitSource(
  options: ProviderServerOptions,
  fileSystemManager: FileSystemManager,
  stateManager?: UpdateStateManager,
): Promise<{ contentAvailable: boolean; version?: string }> {
  const errors: string[] = [];

  try {
    await performGitInitialization(options, fileSystemManager, stateManager);
  } catch (error: unknown) {
    let message: string;
    if (error instanceof BackendError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = `An unexpected error occurred during GitHub initialization: ${error.message}`;
    } else {
      message = `An unexpected error occurred during GitHub initialization: ${String(error)}`;
    }

    // Notify state manager of failure
    stateManager?.failUpdate(message);

    errors.push(message);
  }

  if (errors.length > 0) {
    throw ValidationError.fromErrors(errors);
  }

  const version = await fileSystemManager.getCurrentVersion();
  return { contentAvailable: true, version: version ?? undefined };
}

async function performGitInitialization(
  options: ProviderServerOptions,
  fileSystemManager: FileSystemManager,
  stateManager?: UpdateStateManager,
): Promise<void> {
  const githubApiUrl = options.githubApiUrl!;
  const githubRepository = options.githubRepository!;
  const githubBranch = options.githubBranch!;
  const githubToken = options.githubToken!;
  let branchChanged = false;

  log.info(`Initializing GitHub repository: ${githubRepository} (branch: ${githubBranch})`);

  // Check if we already have valid content from the correct branch
  const currentVersion = await fileSystemManager.getCurrentVersion();
  const currentPath = fileSystemManager.getCurrentPath();
  const existingMetadata = await fileSystemManager.getMetadata();

  log.info(`Checking existing content...`);

  if (currentVersion && currentPath && existingMetadata) {
    // Check if the branch and repository match
    const branchMatches = existingMetadata.branch === githubBranch;
    const repoMatches = existingMetadata.repository === githubRepository;

    log.info(
      `Current content: branch=${existingMetadata.branch}, repo=${existingMetadata.repository}, commit=${existingMetadata.commitHash?.substring(0, 7)}`,
    );
    log.info(`Requested: branch=${githubBranch}, repo=${githubRepository}`);

    if (!branchMatches || !repoMatches) {
      log.info(`Branch or repository has changed. Cleaning existing data and fetching fresh content...`);
      log.info(`  Previous: branch=${existingMetadata.branch}, repo=${existingMetadata.repository}`);
      log.info(`  New: branch=${githubBranch}, repo=${githubRepository}`);

      await fileSystemManager.cleanupTempDirectory();

      // Remove current directory content to force fresh clone
      const currentDir = fileSystemManager.getCurrentPath();
      await fsPromises.rm(currentDir, { recursive: true, force: true });
      await fsPromises.mkdir(currentDir, { recursive: true });

      log.info(`Cleaned existing directories for fresh clone from ${githubBranch}`);
      branchChanged = true;
      // Branch or repo changed, need to fetch new content - continue to cloning logic
    } else {
      // Branch and repo match, but we need to check if there are new commits
      const githubConfig = buildGithubConfig({
        apiUrl: githubApiUrl,
        repository: githubRepository,
        branch: githubBranch,
        token: githubToken,
        rootDirectory: options.ordDirectory,
        fetchStrategy: options.fetchStrategy,
      });

      const contentFetcher = new GitCloneContentFetcher(githubConfig);

      try {
        log.info(`Checking for updates on branch ${githubBranch}...`);
        const latestCommitSha = await contentFetcher.getLatestCommitSha();
        log.info(`Latest remote commit: ${latestCommitSha.substring(0, 7)}`);

        if (existingMetadata.commitHash === latestCommitSha) {
          // Commit SHA matches, content is truly up-to-date
          try {
            log.info(`Content is up-to-date. Validating existing content...`);
            validateGitContent(currentPath, options.ordDocumentsSubDirectory);
            log.info(`Existing content is valid. Skipping repository clone.`);
            return; // Content is valid and up-to-date, no need to re-clone
          } catch (validationError) {
            log.warn(`Existing content validation failed: ${validationError}. Will fetch fresh content.`);
            // Content exists but is invalid, continue with cloning
          }
        } else {
          log.info(`New commits detected. Fetching updated content...`);
          log.info(`  Current commit: ${existingMetadata.commitHash?.substring(0, 7)}`);
          log.info(`  Latest commit:  ${latestCommitSha.substring(0, 7)}`);
        }
      } finally {
        contentFetcher.destroy();
      }
    }
  } else {
    if (!existingMetadata) {
      log.info(`No metadata found. Fetching fresh content from GitHub...`);
    } else {
      log.info(`No existing content found. Fetching from GitHub...`);
    }
  }

  // Create content fetcher for cloning
  const githubConfig = buildGithubConfig({
    apiUrl: githubApiUrl,
    repository: githubRepository,
    branch: githubBranch,
    token: githubToken,
    rootDirectory: options.ordDirectory,
    fetchStrategy: options.fetchStrategy,
  });

  const contentFetcher = new GitCloneContentFetcher(githubConfig);

  try {
    // If branch changed, use clean temp directory instead of copying existing git
    const tempDir = branchChanged
      ? await fileSystemManager.getTempDirectory()
      : await fileSystemManager.prepareTempDirectoryWithGit();

    log.info(`Starting repository sync for ${githubRepository} (branch: ${githubBranch})`);
    log.info(`Target directory: ${tempDir}`);

    const startTime = Date.now();

    // Use the unified progress handler with state manager
    const progressHandler = createProgressHandler({
      logger: log,
      ...(stateManager && { emitter: stateManager, emitEvent: "update-progress" }),
    });
    const metadata = await contentFetcher.fetchAllContent(tempDir, progressHandler);

    const syncTime = Math.round((Date.now() - startTime) / 1000);
    log.info(`Repository sync completed in ${syncTime}s (${metadata?.totalFiles || 0} files)`);
    log.info(`Validating content...`);

    try {
      // Validate the cloned git content
      validateGitContent(tempDir, options.ordDocumentsSubDirectory);
      log.info(`GitHub repository validation successful`);

      await fileSystemManager.swapDirectories(tempDir);

      if (metadata) {
        await fileSystemManager.saveMetadata(metadata);
      }

      log.info(`Initial content synchronized successfully`);

      // Notify state manager of successful completion
      stateManager?.completeUpdate();
    } catch (validationError) {
      await fileSystemManager.cleanupTempDirectory();

      // Notify state manager of failure
      const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
      stateManager?.failUpdate(errorMessage);

      throw validationError;
    }
  } finally {
    contentFetcher.destroy();
  }
}
