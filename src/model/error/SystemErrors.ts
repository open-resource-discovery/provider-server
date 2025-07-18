import { BackendError, DetailError } from "./BackendError.js";

/**
 * Error thrown when the system runs out of disk space
 */
export class DiskSpaceError extends BackendError {
  public name = "DiskSpaceError";
  public httpStatusCode = 507; // Insufficient Storage

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "DISK_SPACE_ERROR", target, details);
  }

  public static fromError(error: Error, target?: string): DiskSpaceError {
    const message = "No disk space available";
    const details: DetailError[] = [
      {
        code: "ENOSPC",
        message: error.message || "No space left on device",
      },
    ];

    return new DiskSpaceError(message, target, details);
  }
}

/**
 * Error thrown when the system runs out of memory
 */
export class MemoryError extends BackendError {
  public name = "MemoryError";
  public httpStatusCode = 507; // Insufficient Storage

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "MEMORY_ERROR", target, details);
  }

  public static fromError(error: Error, target?: string): MemoryError {
    const message = "Insufficient memory available";
    const details: DetailError[] = [
      {
        code: "ENOMEM",
        message: error.message || "Out of memory",
      },
    ];

    return new MemoryError(message, target, details);
  }
}
