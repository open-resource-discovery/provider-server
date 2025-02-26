import { ORDConfiguration } from "@sap/open-resource-discovery";
import { WELL_KNOWN_ENDPOINT } from "src/constant.js";
import { OptAuthMethod } from "src/model/cli.js";
import { FastifyInstanceType } from "src/model/fastify.js";

export interface RouterOptions {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  ordConfig: () => Promise<ORDConfiguration>;
}

export abstract class BaseRouter {
  private getOrdConfig: () => Promise<ORDConfiguration>;
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
    server.get(WELL_KNOWN_ENDPOINT, async () => {
      return await this.getOrdConfig();
    });
  }
}
