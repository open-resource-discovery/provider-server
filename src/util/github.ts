import { GitHubInstance } from "src/model/github.js";
import {
  GitHubAccessError,
  GitHubFileNotFoundError,
  GitHubDirectoryNotFoundError,
  GitHubNetworkError,
} from "../model/error/GithubErrors.js";
import { BackendError } from "../model/error/BackendError.js";
import path from "path";
import { Buffer } from "buffer";
import { joinFilePaths, normalizePath } from "./pathUtils.js";

export interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

/**
 * Constructs the GitHub API URL
 * @param host GitHub API endpoint.
 * @param repo GitHub repository. E.g., OWNER/REPO
 * @param branch GitHub branch.
 * @param path File- or directory path. E.g, path/to/file.txt
 */
function getGitHubUrl({ host, repo, branch }: GitHubInstance, githubPath: string): string {
  const normalizedPath = normalizePath(githubPath).replace(/\/$/, "");
  return `${host}/repos/${repo}/contents${normalizedPath.startsWith("/") ? normalizedPath : "/" + normalizedPath}?ref=${branch}`;
}

/**
 * Constructs the GitHub API URL for the branch itself
 * @param host GitHub API endpoint.
 * @param repo GitHub repository. E.g., OWNER/REPO
 * @param branch GitHub branch.
 */
function getGithubBranchUrl({ host, repo, branch }: GitHubInstance): string {
  return `${host}/repos/${repo}/contents?ref=${branch}`;
}

/**
 * Constructs the GitHub API URL for fetching a blob by SHA
 * @param host GitHub API endpoint.
 * @param repo GitHub repository. E.g., OWNER/REPO
 * @param sha The SHA of the blob to fetch.
 */
function getGitHubBlobUrl({ host, repo }: GitHubInstance, sha: string): string {
  return `${host}/repos/${repo}/git/blobs/${sha}`;
}

export async function fetchGitHubFile(instance: GitHubInstance, filePath: string, token?: string): Promise<string> {
  const githubToken = token || process.env.GITHUB_TOKEN;
  const fileUrl = getGitHubUrl(instance, filePath);
  const headers: Record<string, string> = {};
  if (githubToken) {
    headers["Authorization"] = `Token ${githubToken}`;
  }

  try {
    // 1. Fetch file metadata using Contents API
    const metadataResponse = await fetch(fileUrl, { headers });
    const metadata = (await validateGitHubResponse(metadataResponse, filePath, false)) as GitHubContentItem;

    // Ensure it's a file and has a SHA
    if (metadata.type !== "file" || !metadata.sha) {
      throw new GitHubAccessError("Invalid file metadata received", filePath, [
        { code: "INVALID_METADATA", message: "Response is not a file or missing SHA" },
      ]);
    }

    // If content is present and encoding is base64 (small file), decode and return
    if (metadata.content && metadata.encoding === "base64") {
      return Buffer.from(metadata.content, "base64").toString("utf-8");
    }

    // 2. Fetch blob content using Git Data API (Blobs) for large files or if content was missing
    const blobUrl = getGitHubBlobUrl(instance, metadata.sha);
    const blobResponse = await fetch(blobUrl, { headers });

    if (!blobResponse.ok) {
      throw GitHubAccessError.fromHttpError(blobResponse, filePath);
    }

    const blobData = (await blobResponse.json()) as {
      content?: string;
      encoding?: string;
      sha?: string;
      size?: number;
    };

    if (!blobData || typeof blobData.content !== "string" || blobData.encoding !== "base64") {
      throw new GitHubAccessError("Invalid blob content received", filePath, [
        { code: "INVALID_BLOB_CONTENT", message: "Blob response missing content or invalid encoding" },
      ]);
    }

    return Buffer.from(blobData.content, "base64").toString("utf-8");
  } catch (error) {
    handleGitHubError(error, filePath, "fetch GitHub file");
  }
}

async function fetchDirectoryContents(
  instance: GitHubInstance,
  directoryPath: string,
  token?: string,
  recursive = true,
): Promise<GitHubContentItem[]> {
  async function fetchDirectoryContents(dirPath: string): Promise<GitHubContentItem[]> {
    const url = getGitHubUrl(instance, dirPath);

    try {
      const response = await fetch(
        url,
        token
          ? {
              headers: { Authorization: `Token ${token}` },
            }
          : {},
      );

      const contents = (await validateGitHubResponse(response, dirPath, true)) as GitHubContentItem[];

      // If not recursive, return just the files
      if (!recursive) {
        // For backward compatibility, return just the file names for non-recursive calls
        return contents.filter((item) => item.type === "file");
      }

      const directories = contents.filter((item) => item.type === "dir");
      const subDirectoryFiles = await Promise.all(directories.map((dir) => fetchDirectoryContents(dir.path)));

      // Combine all files
      return [...contents, ...subDirectoryFiles.flat()];
    } catch (error) {
      handleGitHubError(error, dirPath, "list GitHub directory");
    }
  }

  return await fetchDirectoryContents(directoryPath);
}

export async function getGithubDirectoryContents(
  instance: GitHubInstance,
  directoryPath: string,
  token?: string,
  recursive: boolean = true,
): Promise<GitHubContentItem[]> {
  return await fetchDirectoryContents(instance, directoryPath, token, recursive);
}

export async function getDirectoryHash(
  instance: GitHubInstance,
  directoryPath: string,
  token?: string,
): Promise<string | undefined> {
  // Parse directoryPath first
  const dirPath =
    directoryPath === "/" || directoryPath === "" || directoryPath === "./" ? "/" : joinFilePaths(directoryPath, "..");

  const lastDirectory = path.posix.parse(directoryPath).base;

  let githubUrl: string;
  if (dirPath === "/" && lastDirectory === "/") {
    // Fetch current branch SHA
    githubUrl = getGithubBranchUrl(instance);
  } else {
    githubUrl = getGitHubUrl(instance, dirPath);
  }

  const response = await fetch(
    githubUrl,
    token
      ? {
          headers: { Authorization: `Token ${token}` },
        }
      : {},
  );

  const items = (await response.json()) as GitHubContentItem[];

  for (const item of items) {
    if (item.name === lastDirectory) {
      return item.sha;
    }
  }
}

/**
 * Validates and processes the GitHub API response
 * @throws {GitHubAccessError} When the response is not OK
 * @throws {GitHubFileNotFoundError} When a file is not found
 * @throws {GitHubDirectoryNotFoundError} When a directory is not found
 */
async function validateGitHubResponse(
  response: Response,
  path: string,
  expectDirectory = false,
): Promise<GitHubContentItem | GitHubContentItem[]> {
  if (!response.ok) {
    if (response.status === 404) {
      if (expectDirectory) {
        throw GitHubDirectoryNotFoundError.forPath(path);
      }
      throw GitHubFileNotFoundError.forPath(path);
    }
    throw GitHubAccessError.fromHttpError(response, path);
  }

  try {
    const data = await response.json();

    if (!data) {
      throw new GitHubAccessError("Invalid GitHub content", path, [
        {
          code: "INVALID_CONTENT",
          message: "Received empty content",
        },
      ]);
    }

    // Validate response type based on expectation
    if (expectDirectory) {
      if (!isDirectoryListing(data)) {
        if (isFileResponse(data)) {
          throw GitHubDirectoryNotFoundError.forPath(
            path,
            new Error(`Expected directory but received file: ${data.name}`),
          );
        }
        throw GitHubDirectoryNotFoundError.forPath(path, new Error("Response is not a directory listing"));
      }
    } else {
      if (!isFileResponse(data) && !isDirectoryListing(data)) {
        throw new GitHubAccessError("Invalid content type", path, [
          {
            code: "INVALID_CONTENT_TYPE",
            message: "Response is neither a file nor a directory listing",
          },
        ]);
      }
    }

    return data;
  } catch (parseError) {
    if (parseError instanceof BackendError) {
      throw parseError;
    }
    throw new GitHubAccessError("Invalid JSON response from GitHub", path, [
      {
        code: "INVALID_JSON",
        message: String(parseError),
      },
    ]);
  }
}

/**
 * Handles common GitHub API errors
 * @throws {BackendError} Rethrows Backend errors
 * @throws {GitHubNetworkError} For network-related errors
 * @throws {GitHubAccessError} For unexpected errors
 */
function handleGitHubError(error: unknown, path: string, operation: string): never {
  if (error instanceof BackendError) {
    throw error;
  }

  if (error instanceof TypeError || (error as Error).name === "TypeError") {
    throw GitHubNetworkError.fromError(error as Error, path);
  }

  throw new GitHubAccessError(`Failed to ${operation}`, path, [
    {
      code: "UNEXPECTED_ERROR",
      message: String(error),
    },
  ]);
}

/**
 * Type guard to check if the response is a directory listing
 */
function isDirectoryListing(data: unknown): data is GitHubContentItem[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) => typeof item === "object" && item !== null && "name" in item && "type" in item && "path" in item,
    )
  );
}

/**
 * Type guard to check if the response is a file
 */
function isFileResponse(data: unknown): data is GitHubContentItem {
  return (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    "type" in data &&
    "path" in data &&
    (data as GitHubContentItem).type === "file"
  );
}
