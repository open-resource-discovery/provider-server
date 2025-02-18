import { FastifyInstance as BaseFastifyInstance, RawServerDefault, FastifyTypeProviderDefault } from "fastify";
import { IncomingMessage, ServerResponse } from "http";
import { Logger } from "pino";

export type FastifyInstanceType = BaseFastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger,
  FastifyTypeProviderDefault
>;
