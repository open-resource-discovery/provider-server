import { BackendError, DetailError } from "src/model/error/BackendError.js";

export class NotFoundError extends BackendError {
  public name = "NotFoundError";
  public httpStatusCode = 404;
  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "NOT_FOUND", target, details);
  }
}
