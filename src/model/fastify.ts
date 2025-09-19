import {
  FastifyInstance as BaseFastifyInstance,
  RawServerDefault,
  FastifyTypeProviderDefault,
  FastifyBaseLogger,
} from "fastify";
import { IncomingMessage, ServerResponse } from "http";

export type FastifyInstanceType = BaseFastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  FastifyBaseLogger,
  FastifyTypeProviderDefault
>;
