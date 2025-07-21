import { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { comparePassword } from "src/util/passwordHash.js";
import { config } from "dotenv";
import { log } from "../util/logger.js";
config();

export function createBasicAuthValidator(validUsers: Record<string, string>) {
  return async function validateBasicAuth(
    username: string,
    password: string,
    _req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    try {
      const storedPassword = validUsers[username];
      const isValid = await comparePassword(password, storedPassword);

      if (!isValid) {
        throw new UnauthorizedError("Unauthorized");
      }
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        log.error(error);
      }
      throw new UnauthorizedError("Unauthorized");
    }
  };
}
