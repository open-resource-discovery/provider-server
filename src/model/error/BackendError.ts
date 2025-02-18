export interface ErrorResponse {
  error: ErrorItem;
}

export interface ErrorItem {
  code: string;
  message: string;
  target?: string;
  details?: DetailError[];
}

export interface DetailError {
  code: string;
  message: string;
}

/**
 * Base class for all custom errors
 */
export abstract class BackendError extends Error {
  public name = "BackendError";

  /**
   * The HTTP response status code that this error should result in
   * We default to 500 if we don't know better.
   */
  public httpStatusCode = 500;

  /**
   * The HTTP response error item
   *
   * Will be wrapped in Error Response later
   */
  public errorItem: ErrorItem;

  public constructor(message: string, code?: string, target?: string, details?: DetailError[]) {
    super(message);
    this.name = "BackendError";
    this.errorItem = {
      message: message,
      code: code ?? "INTERNAL_SERVER_ERROR",
    };
    if (target) {
      this.errorItem.target = target;
    }
    if (details) {
      this.errorItem.details = details;
    }
  }

  public getErrorResponse(): ErrorResponse {
    return {
      error: this.errorItem,
    };
  }

  public getHttpStatusCode(): number {
    return this.httpStatusCode;
  }
}
