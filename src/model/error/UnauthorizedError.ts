import { BackendError, DetailError } from "src/model/error/BackendError.js";

export class UnauthorizedError extends BackendError {
  public name = "UnauthorizedError";
  public httpStatusCode = 401;
  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "UNAUTHORIZED", target, details);
  }
}
