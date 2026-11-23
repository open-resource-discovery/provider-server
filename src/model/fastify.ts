import type { FastifyInstance as BaseFastifyInstance, FastifyTypeProviderDefault, RawServerDefault } from "fastify";
import type { IncomingMessage, ServerResponse } from "http";
import type { Logger } from "pino";

export type FastifyInstanceType = BaseFastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger,
  FastifyTypeProviderDefault
>;
