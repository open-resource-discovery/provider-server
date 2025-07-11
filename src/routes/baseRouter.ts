import { ORDConfiguration } from "@open-resource-discovery/specification";
import { PATH_CONSTANTS } from "src/constant.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { Perspective } from "src/model/perspective.js";

export interface RouterOptions {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  ordConfig: (perspective?: Perspective) => Promise<ORDConfiguration>;
}

export abstract class BaseRouter {
  private getOrdConfig: (perspective?: Perspective) => Promise<ORDConfiguration>;
  protected baseUrl: string;
  protected authMethods: OptAuthMethod[];

  public constructor(options: RouterOptions) {
    this.getOrdConfig = options.ordConfig;
    this.baseUrl = options.baseUrl;
    this.authMethods = options.authMethods;
  }

  public abstract register(server: FastifyInstanceType): void;

  public updateORDConfig(configGetter: RouterOptions["ordConfig"]): void {
    this.getOrdConfig = configGetter;
  }

  protected configurationEndpoint(server: FastifyInstanceType): void {
    server.get<{ Querystring: { perspective?: string } }>(PATH_CONSTANTS.WELL_KNOWN_ENDPOINT, async (request) => {
      const perspective = request.query.perspective as Perspective | undefined;
      return await this.getOrdConfig(perspective);
    });
  }
}
