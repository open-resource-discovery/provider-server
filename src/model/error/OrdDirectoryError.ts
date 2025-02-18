import { BackendError, DetailError } from "./BackendError.js";

export class LocalDirectoryError extends BackendError {
  public name = "LocalDirectoryError";
  public httpStatusCode = 400;

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "LOCAL_DIRECTORY_ERROR", target, details);
  }

  public static forPath(path: string, reason: string): LocalDirectoryError {
    return new LocalDirectoryError(`Invalid local directory structure: ${reason}`, path, [
      {
        code: "INVALID_DIRECTORY_STRUCTURE",
        message: reason,
      },
    ]);
  }
}
