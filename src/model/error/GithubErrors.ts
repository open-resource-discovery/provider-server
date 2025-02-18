import { BackendError, DetailError } from "./BackendError.js";

export class GitHubAccessError extends BackendError {
  public name = "GitHubAccessError";
  public httpStatusCode = 401;

  public constructor(message: string, target?: string, details?: DetailError[], statusCode?: number) {
    super(message, "GITHUB_ACCESS_ERROR", target, details);
    if (statusCode) {
      this.httpStatusCode = statusCode;
    }
  }

  public static fromHttpError(response: Response, target?: string): GitHubAccessError {
    const statusCode = response.status;
    const message = `GitHub access failed: ${response.status} ${response.statusText}`;
    const details: DetailError[] = [
      {
        code: `HTTP_${statusCode}`,
        message: response.statusText,
      },
    ];

    return new GitHubAccessError(message, target, details, statusCode);
  }
}

export class GitHubFileNotFoundError extends BackendError {
  public name = "GitHubFileNotFoundError";
  public httpStatusCode = 404;

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "GITHUB_FILE_NOT_FOUND", target, details);
  }

  public static forPath(path: string, originalError?: Error): GitHubFileNotFoundError {
    const message = `GitHub file not found: ${path}`;
    const details: DetailError[] = [];

    if (originalError) {
      details.push({
        code: "ORIGINAL_ERROR",
        message: originalError.message,
      });
    }

    return new GitHubFileNotFoundError(message, path, details);
  }
}

export class GitHubNetworkError extends BackendError {
  public name = "GitHubNetworkError";
  public httpStatusCode = 503; // Service Unavailable

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "GITHUB_NETWORK_ERROR", target, details);
  }

  public static fromError(error: Error, target: string): GitHubNetworkError {
    let errorMessage = "Failed to connect to GitHub";
    let errorDetails: DetailError[] = [
      {
        code: "CONNECTION_ERROR",
        message: error.message,
      },
    ];

    if (error instanceof TypeError && error.message === "Failed to fetch") {
      errorMessage = "Unable to reach GitHub server";
      errorDetails = [
        {
          code: "NETWORK_UNREACHABLE",
          message: "Network connection failed or GitHub server is unreachable",
        },
      ];
    }

    return new GitHubNetworkError(errorMessage, target, errorDetails);
  }
}

export class GitHubDirectoryNotFoundError extends BackendError {
  public name = "GitHubDirectoryNotFoundError";
  public httpStatusCode = 404;

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "GITHUB_DIRECTORY_NOT_FOUND", target, details);
  }

  public static forPath(path: string, originalError?: Error): GitHubDirectoryNotFoundError {
    const message = `GitHub Directory not found: ${path}`;
    const details: DetailError[] = [];

    if (originalError) {
      details.push({
        code: "ORIGINAL_ERROR",
        message: originalError.message,
      });
    }

    return new GitHubDirectoryNotFoundError(message, path, details);
  }
}

export class GitHubDirectoryInvalidError extends BackendError {
  public name = "GitHubDirectoryInvalidError";
  public httpStatusCode = 400;

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "GITHUB_DIRECTORY_INVALID_ERROR", target, details);
  }

  public static forPath(path: string, originalError?: Error): GitHubDirectoryInvalidError {
    const message = `No valid document found in directory: ${path}`;
    const details: DetailError[] = [];

    if (originalError) {
      details.push({
        code: "ORIGINAL_ERROR",
        message: originalError.message,
      });
    }

    return new GitHubDirectoryInvalidError(message, path, details);
  }
}
