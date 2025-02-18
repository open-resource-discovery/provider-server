import { BackendError, DetailError } from "./BackendError.js";

export class ValidationError extends BackendError {
  public name = "ValidationError";
  public httpStatusCode = 400;

  public constructor(message: string, details: DetailError[]) {
    super(message, "VALIDATION_ERROR", "configuration", details);
  }

  public static fromErrors(errors: string[]): ValidationError {
    const details: DetailError[] = errors.map((error) => ({
      code: "INVALID_CONFIG",
      message: error,
    }));

    const message = errors.map((error) => `- ${error}`).join("\n");

    return new ValidationError(`\n${message}`, details);
  }
}
