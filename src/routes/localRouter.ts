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
      const documentName = path.parse(request.url.replace(`${ORD_DOCUMENTS_URL_PATH}/`, "")).base.replace(/\.json/, "");
      if (this.ordDocuments[documentName]) {
        return this.ordDocuments[documentName];
      }
      throw new NotFoundError(`Could not find ORD document: ${documentName}`);
    });

    // FQN Document endpoint
    server.get(`${ORD_SERVER_PREFIX_PATH}/:ordId/:fileName`, (request, reply) => {
      const { ordId, fileName } = request.params as { ordId: string; fileName: string };
      const resourceMap = this.fqnDocumentMap[ordId]?.find((resource) => resource.fileName === fileName);

      if (resourceMap) {
        return reply.sendFile(resourceMap.filePath, this.ordDirectory);
      }

      // Check if file exists in static directory as fallback
      const requestedPath = path.join(ordId, fileName);

      try {
        return reply.sendFile(requestedPath, this.ordDirectory);
      } catch (err) {
        log.error(err);
        throw new NotFoundError(`Could not find resource ${ordId}/${fileName}`);
      }
    });

    // Register static files after API routes
    await server.register(fastifyStatic, {
      prefix: ORD_SERVER_PREFIX_PATH,
      root: path.resolve(process.cwd(), this.ordDirectory),
      etag: true,
    });
  }

  private checkStaticFiles(): void {
    const staticFiles = getAllFiles(this.ordDirectory);

    for (const file of staticFiles) {
      const relativeUrl = `${ORD_SERVER_PREFIX_PATH}/${path.relative(this.ordDirectory, file).split("\\").join("/")}`;
      log.info(`Served static file: ${this.baseUrl}${relativeUrl}`);
    }
  }
}
