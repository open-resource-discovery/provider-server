import { BackendError, DetailError } from "src/model/error/BackendError.js";

/**
 * Internal Server Error
 * Use this only as a fallback if no more specific error is available
 */
export class InternalServerError extends BackendError {
  public name = "InternalServerError";
  public httpStatusCode = 500;
  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "INTERNAL_SERVER_ERROR", target, details);
  }
}
