/* eslint-disable @typescript-eslint/no-explicit-any */

import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { BackendError } from "src/model/error/BackendError.js";
import { InternalServerError } from "src/model/error/InternalServerError.js";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";

function isFastifyError(err: any): err is FastifyError {
  return err instanceof Error && err.name === "FastifyError" && "statusCode" in err && "code" in err;
}

/**
 * This error handler will convert the various kind of errors that could happen
 * into SAP API Harmonization Guideline compatible Error Responses
 *
 * Please be aware that this is simplified and not as complete as it could be.
 */
export function errorHandler(err: Error | FastifyError | any, req: FastifyRequest, reply: FastifyReply): void {
  /** We always cast incoming errors into our own error classes */
  let castedError: BackendError;

  if (err instanceof BackendError) {
    // The error is already one of our own custom errors, no casting necessary
    castedError = err;
  } else if (
    isFastifyError(err) &&
    err.statusCode === 401 &&
    err.code === "FST_BASIC_AUTH_MISSING_OR_BAD_AUTHORIZATION_HEADER"
  ) {
    castedError = new UnauthorizedError("Unauthorized");
  } else if (err instanceof Error) {
    // Handle generic errors we couldn't handle so far
    castedError = new InternalServerError(`Internal Server error: ${err.message}`);
  } else {
    // Handle strange case when something else than an error has been thrown :)
    castedError = new InternalServerError("Unsupported throw use.");
  }

  req.log.error(`ERROR ${castedError.getHttpStatusCode()}`, castedError.getErrorResponse());

  reply
    .code(castedError.getHttpStatusCode())
    .header("Content-Type", "application/json; charset=utf-8")
    .send(castedError.getErrorResponse());
}
