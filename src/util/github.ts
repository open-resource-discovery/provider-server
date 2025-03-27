import { GitHubInstance } from "src/model/github.js";
import {
  GitHubAccessError,
  GitHubFileNotFoundError,
  GitHubDirectoryNotFoundError,
  GitHubNetworkError,
} from "../model/error/GithubErrors.js";
import { BackendError } from "../model/error/BackendError.js";
import path from "path";

export interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  sha: string;
  size: number;
}

/**
 * Constructs the GitHub API URL
 * @param host GitHub API endpoint.
 * @param repo GitHub repository. E.g., OWNER/REPO
 * @param branch GitHub branch.
 * @param path File- or directory path. E.g, path/to/file.txt
 */
function getGitHubUrl({ host, repo, branch }: GitHubInstance, githubPath: string): string {
  return `${host}/repos/${repo}/contents${path.posix.join("/", githubPath.replace(/\/$/, ""))}?ref=${branch}`;
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

export async function fetchGitHubFile<T>(instance: GitHubInstance, filePath: string, token?: string): Promise<T> {
  const githubToken = token || process.env.GITHUB_TOKEN;
  const fileUrl = getGitHubUrl(instance, filePath);

  try {
    const response = await fetch(
      fileUrl,
      githubToken
        ? {
            headers: { Authorization: `Token ${githubToken}` },
          }
        : {},
    );

    const data = await validateGitHubResponse(response, filePath, false);
    return data as T;
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
    directoryPath === "/" || directoryPath === "" || directoryPath === "./"
      ? "/"
      : path.posix.join(directoryPath, "..");

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
