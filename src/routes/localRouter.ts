import fastifyStatic from "@fastify/static";
import { ORDDocument } from "@open-resource-discovery/specification";
import fs from "fs";
import path from "path";
import { PATH_CONSTANTS } from "src/constant.js";
import { joinFilePaths, joinUrlPaths } from "src/util/pathUtils.js";
import { NotFoundError } from "src/model/error/NotFoundError.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { BaseRouter, RouterOptions } from "src/routes/baseRouter.js";
import { getAllFiles } from "src/util/files.js";
import { log } from "src/util/logger.js";
import { FqnDocumentMap, isOrdId } from "../util/fqnHelpers.js";
import { ordIdToPathSegment } from "../util/pathUtils.js";

interface LocalRouterOptions extends RouterOptions {
  ordDirectory: string;
  ordDocuments: { [key: string]: ORDDocument };
  fqnDocumentMap: FqnDocumentMap;
  documentsSubDirectory?: string;
}

export class LocalRouter extends BaseRouter {
  private ordDirectory: string;
  private ordDocuments: { [key: string]: ORDDocument };
  private fqnDocumentMap: FqnDocumentMap;
  private documentsSubDirectory: string;

  public constructor(options: LocalRouterOptions) {
    super(options);
    this.ordDirectory = options.ordDirectory;
    this.ordDocuments = options.ordDocuments;
    this.fqnDocumentMap = options.fqnDocumentMap;
    this.documentsSubDirectory = options.documentsSubDirectory || "documents";
  }

  public updateConfig(options: LocalRouterOptions): void {
    this.updateORDConfig(options.ordConfig);
    this.ordDirectory = options.ordDirectory;
    this.ordDocuments = options.ordDocuments;
    this.fqnDocumentMap = options.fqnDocumentMap;
    if (options.documentsSubDirectory) {
      this.documentsSubDirectory = options.documentsSubDirectory;
    }
  }

  public async register(server: FastifyInstanceType): Promise<void> {
    // Configuration endpoint
    this.configurationEndpoint(server);

    // TODO: Right now we don't make use of this
    // In the future, we could check whether the references to the static files are correct
    // and we can create absolute URLs
    this.checkStaticFiles();

    // First, register static files but don't let it create routes
    await server.register(fastifyStatic, {
      prefix: PATH_CONSTANTS.SERVER_PREFIX,
      root: path.resolve(process.cwd(), this.ordDirectory),
      etag: true,
      decorateReply: true,
      // Don't automatically create routes
      serve: false,
    });

    // 1. Document endpoint
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/${this.documentsSubDirectory}/*`, (request) => {
      let { "*": documentPath } = request.params as { "*": string };

      documentPath = documentPath.replace(/\.json/, "");
      const documentPathWithSubfolder = joinFilePaths(this.documentsSubDirectory, documentPath);
      if (this.ordDocuments[documentPathWithSubfolder]) {
        return this.ordDocuments[documentPathWithSubfolder];
      }
      throw new NotFoundError(`Could not find ORD document: ${documentPathWithSubfolder}`);
    });

    // 2. Root-level files endpoint
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:fileName`, (request, reply) => {
      const { fileName } = request.params as { fileName: string };

      // Skip if this is a documents route or another known route
      if (fileName === this.documentsSubDirectory) {
        return reply.callNotFound();
      }

      // Try to serve the file directly from the root of the ordDirectory
      try {
        const absolutePath = joinFilePaths(this.ordDirectory, fileName);

        if (fs.existsSync(absolutePath)) {
          return reply.sendFile(fileName, this.ordDirectory);
        }

        // If we get here, the file doesn't exist
        return reply.callNotFound();
      } catch (err) {
        log.error(err);
        return reply.callNotFound();
      }
    });

    // 3. FQN Document endpoint
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:ordId/*`, (request, reply) => {
      const { ordId } = request.params as { ordId: string };
      const { "*": unknownPath } = request.params as { "*": string };

      // Skip if this is a documents route
      if (ordId === this.documentsSubDirectory) {
        return reply.callNotFound();
      }

      // Extract all possible subpaths from the URL
      const fullPath = [ordId, ...unknownPath.split("/")];

      // First, try with the first segment as ordId (simple case)
      if (isOrdId(ordId)) {
        let resourceMap = this.fqnDocumentMap[ordId]?.find((resource) => resource.fileName === unknownPath);
        if (resourceMap) {
          return reply.sendFile(resourceMap.filePath, this.ordDirectory);
        }

        // Also try with the underscore version of the ordId (for filesystem compatibility)
        const underscoreOrdId = ordIdToPathSegment(ordId);
        resourceMap = this.fqnDocumentMap[underscoreOrdId]?.find((resource) => resource.fileName === unknownPath);
        if (resourceMap) {
          return reply.sendFile(resourceMap.filePath, this.ordDirectory);
        }
      }

      // Try to find a valid ordId in the path using the ordIdPattern
      for (let i = 0; i < fullPath.length; i++) {
        for (let j = i + 1; j <= fullPath.length; j++) {
          const potentialOrdId = fullPath.slice(i, j).join("/");

          // Test if this is a valid ordId using the pattern
          if (isOrdId(potentialOrdId)) {
            const afterSegments = j < fullPath.length ? fullPath.slice(j) : [];
            const remainingPath = afterSegments.join("/");

            // Skip empty filenames
            if (!remainingPath) continue;

            const resourceMap = this.fqnDocumentMap[potentialOrdId]?.find(
              (resource) => resource.fileName === remainingPath,
            );

            if (resourceMap) {
              return reply.sendFile(resourceMap.filePath, this.ordDirectory);
            }

            // Also try with the underscore version
            const underscoreOrdId = ordIdToPathSegment(potentialOrdId);
            const underscoreResourceMap = this.fqnDocumentMap[underscoreOrdId]?.find(
              (resource) => resource.fileName === remainingPath,
            );

            if (underscoreResourceMap) {
              return reply.sendFile(underscoreResourceMap.filePath, this.ordDirectory);
            }
          }
        }
      }

      // Try as a static file (last resort)
      try {
        // First check if the file exists
        // If not found in the map, try to fetch it directly
        const fullPath = joinFilePaths(ordId, unknownPath);
        const absolutePath = joinFilePaths(this.ordDirectory, fullPath);

        if (fs.existsSync(absolutePath)) {
          return reply.sendFile(fullPath, this.ordDirectory);
        }

        // If we get here, the file doesn't exist
        return reply.callNotFound();
      } catch (err) {
        log.error(err);
        return reply.callNotFound();
      }
    });
  }

  private checkStaticFiles(): void {
    const staticFiles = getAllFiles(this.ordDirectory);

    for (const file of staticFiles) {
      const relativePath = path.relative(this.ordDirectory, file).split("\\").join("/");
      const relativeUrl = joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, relativePath);
      log.info(`Served static file: ${this.baseUrl}${relativeUrl}`);
    }
  }
}
