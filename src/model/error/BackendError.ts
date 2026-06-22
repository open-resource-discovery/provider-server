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
 * Snapshot of an error suitable for the /health and /status endpoints.
 * Carries the HTTP code/text alongside the user-facing ErrorItem so
 * consumers don't have to map error codes to HTTP responses themselves.
 */
export interface StatusError {
  httpStatusCode: number;
  httpStatusText: string;
  item: ErrorItem;
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
   * Short status string suitable for the /health endpoint payload.
   * Subclasses override to map their httpStatusCode to a stable label
   * (e.g. "insufficient_storage", "service_unavailable").
   */
  public httpStatusText = "failed";

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

/**
 * Build a StatusError from any thrown value. BackendError keeps its
 * httpStatusCode/Text; everything else collapses to a generic 500.
 */
export function toStatusError(error: unknown): StatusError {
  if (error instanceof BackendError) {
    return {
      httpStatusCode: error.httpStatusCode,
      httpStatusText: error.httpStatusText,
      item: error.errorItem,
    };
  }
  return {
    httpStatusCode: 500,
    httpStatusText: "failed",
    item: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) },
  };
}
