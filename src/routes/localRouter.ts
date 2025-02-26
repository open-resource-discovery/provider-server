import fastifyStatic from "@fastify/static";
import { ORDDocument } from "@sap/open-resource-discovery";
import path from "path";
import { ORD_DOCUMENTS_URL_PATH, ORD_SERVER_PREFIX_PATH } from "src/constant.js";
import { NotFoundError } from "src/model/error/NotFoundError.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { BaseRouter, RouterOptions } from "src/routes/baseRouter.js";
import { getAllFiles } from "src/util/files.js";
import { log } from "src/util/logger.js";
import { FqnDocumentMap } from "../util/fqnHelpers.js";

interface LocalRouterOptions extends RouterOptions {
  ordDirectory: string;
  ordDocuments: { [key: string]: ORDDocument };
  fqnDocumentMap: FqnDocumentMap;
}

export class LocalRouter extends BaseRouter {
  private ordDirectory: string;
  private ordDocuments: { [key: string]: ORDDocument };
  private fqnDocumentMap: FqnDocumentMap;

  public constructor(options: LocalRouterOptions) {
    super(options);
    this.ordDirectory = options.ordDirectory;
    this.ordDocuments = options.ordDocuments;
    this.fqnDocumentMap = options.fqnDocumentMap;
  }

  public updateConfig(options: LocalRouterOptions): void {
    this.updateORDConfig(options.ordConfig);
    this.ordDirectory = options.ordDirectory;
    this.ordDocuments = options.ordDocuments;
    this.fqnDocumentMap = options.fqnDocumentMap;
  }

  public async register(server: FastifyInstanceType): Promise<void> {
    // Configuration endpoint
    this.configurationEndpoint(server);

    // TODO: Right now we don't make use of this
    // In the future, we could check whether the references to the static files are correct
    // and we can create absolute URLs
    this.checkStaticFiles();

    // Document endpoint
    server.get(`${ORD_DOCUMENTS_URL_PATH}/:documentName`, (request) => {
      const documentName = request.url.replace(`${ORD_DOCUMENTS_URL_PATH}/`, "");
      if (this.ordDocuments[documentName]) {
        return this.ordDocuments[documentName];
      }
      throw new NotFoundError(`Could not find ORD document: ${documentName}`);
    });

    // FQN Document endpoint
    server.get(`${ORD_SERVER_PREFIX_PATH}/:ordId/:fileName`, (request, reply) => {
      const { ordId, fileName } = request.params as { ordId: string; fileName: string };
      const resourceMap = this.fqnDocumentMap[ordId]?.find((resource) => resource.fileName === fileName);

      if (!resourceMap) throw new NotFoundError(`Could not find resource ${ordId}/${fileName}`);

      reply.sendFile(resourceMap.filePath, this.ordDirectory);
    });

    // Static files
    await server.register(fastifyStatic, {
      prefix: `${ORD_SERVER_PREFIX_PATH}`,
      root: path.resolve(process.cwd(), this.ordDirectory),
      etag: true,
    });
  }

  private checkStaticFiles(): void {
    log.info("------------------------------------------------------------");
    log.info(`Looking for static files in: ${this.ordDirectory}`);
    const staticFiles = getAllFiles(this.ordDirectory);

    for (const file of staticFiles) {
      const relativeUrl = `/${path.relative(this.ordDirectory, file).split("\\").join("/")}`;
      log.info(`>> Served: ${this.baseUrl}${relativeUrl}`);
    }
  }
}
