/* eslint-disable @typescript-eslint/no-unused-vars */
import { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "src/model/error/UnauthorizedError.js";
import { config } from "dotenv";
config();

export function createBasicAuthValidator(validUsers: Record<string, string>) {
  return function validateBasicAuth(
    username: string,
    password: string,
    req: FastifyRequest,
    reply: FastifyReply,
    done: (error?: Error) => void,
  ): void {
    if (validUsers[username] && validUsers[username] === password) {
      done();
    } else {
      throw new UnauthorizedError("Unauthorized");
    }
  };
}
