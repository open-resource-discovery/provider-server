import { BackendError, DetailError } from "src/model/error/BackendError.js";

export class TrustedSubjectError extends BackendError {
  public name = "TrustedSubjectError";
  public httpStatusCode = 500;

  public constructor(message: string, target?: string, details?: DetailError[]) {
    super(message, "TRUSTED_SUBJECT_ERROR", target, details);
  }
}
