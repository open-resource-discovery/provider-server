import { WELL_KNOWN_ENDPOINT } from "src/constant.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { OptAuthMethod } from "src/model/cli.js";
import { ORDConfiguration } from "@sap/open-resource-discovery";

export interface RouterOptions {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  ordConfig: () => Promise<ORDConfiguration>;
}

export abstract class BaseRouter {
  protected getOrdConfig: () => Promise<ORDConfiguration>;
  protected baseUrl: string;
  protected authMethods: OptAuthMethod[];

  public constructor(options: RouterOptions) {
    this.getOrdConfig = options.ordConfig;
    this.baseUrl = options.baseUrl;
    this.authMethods = options.authMethods;
  }

  public abstract register(server: FastifyInstanceType): void;

  protected configurationEndpoint(server: FastifyInstanceType): void {
    server.get(WELL_KNOWN_ENDPOINT, async () => {
      return await this.getOrdConfig();
    });
  }
}
