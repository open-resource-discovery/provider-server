import { FastifyInstanceType } from "../model/fastify.js";
import { DocumentService } from "../services/interfaces/documentService.js";
import { PATH_CONSTANTS } from "../constant.js";
import { log } from "../util/logger.js";
import { BaseRouter } from "./baseRouter.js";
import { FqnDocumentMap, isOrdId } from "../util/fqnHelpers.js";
import { joinFilePaths, ordIdToPathSegment } from "../util/pathUtils.js";
import { OptAuthMethod } from "../model/cli.js";
import { BackendError } from "../model/error/BackendError.js";
import { InternalServerError } from "../model/error/InternalServerError.js";
import { NotFoundError } from "../model/error/NotFoundError.js";

interface DocumentRouterOptions {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  fqnDocumentMap: FqnDocumentMap;
  documentsSubDirectory?: string;
}

export class DocumentRouter extends BaseRouter {
  private readonly documentService: DocumentService;
  private readonly fqnDocumentMap: FqnDocumentMap;
  private readonly documentsSubDirectory: string;

  public constructor(documentService: DocumentService, options: DocumentRouterOptions) {
    super({
      baseUrl: options.baseUrl,
      authMethods: options.authMethods,
      ordConfig: documentService.getOrdConfiguration.bind(documentService),
    });
    this.documentService = documentService;
    this.fqnDocumentMap = options.fqnDocumentMap;
    this.documentsSubDirectory = options.documentsSubDirectory || PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY;
  }

  public register(server: FastifyInstanceType): void {
    // BaseRouter handles the configuration endpoint now
    this.configurationEndpoint(server);

    // Document endpoint - delegates to service
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/${this.documentsSubDirectory}/*`, async (request, reply) => {
      const { "*": documentPath } = request.params as { "*": string };
      const relativePath = `${this.documentsSubDirectory}/${documentPath}`;

      // If the path has a non-JSON file extension, serve as raw file content.
      // Use a strict regex to avoid matching ORD-style names with dots (e.g., "sap.ref-app-example").
      const fileName = documentPath.split("/").pop() || "";
      const hasFileExtension = /\.[a-zA-Z0-9]{1,10}$/.test(fileName);
      if (hasFileExtension && !documentPath.endsWith(".json")) {
        log.info(`[FILES ROUTE] Request received for file: ${relativePath}`);
        try {
          const content = await this.documentService.getFileContent(relativePath);
          return reply.send(content);
        } catch (error) {
          log.error(`Error fetching file ${relativePath}: ${error}`);
          if (error instanceof BackendError) {
            throw error;
          } else {
            throw new InternalServerError(error instanceof Error ? error.message : "Unknown error");
          }
        }
      }

      const documentPathWithExtension = documentPath.endsWith(".json") ? documentPath : `${documentPath}.json`;
      const documentRelativePath = `${this.documentsSubDirectory}/${documentPathWithExtension}`;
      log.info(`[DOCUMENTS ROUTE] Request received for ORD document: ${documentRelativePath}`);

      try {
        const document = await this.documentService.getProcessedDocument(documentRelativePath);
        return reply.send(document);
      } catch (error) {
        // If NotFoundError for a .json path, the file might be a resource file (e.g. Swagger/OpenAPI)
        // rather than an ORD document. Fall back to serving it as raw file content.
        if (error instanceof NotFoundError && documentPath.endsWith(".json")) {
          log.info(`[DOCUMENTS ROUTE] Not an ORD document, falling back to file serving: ${relativePath}`);
          try {
            const content = await this.documentService.getFileContent(relativePath);
            const contentString = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
            try {
              const jsonData = JSON.parse(contentString);
              return reply.type("application/json").send(jsonData);
            } catch (_parseError) {
              return reply.type("application/json").send(contentString);
            }
          } catch (fileError) {
            if (fileError instanceof BackendError) {
              throw fileError;
            }
            throw new InternalServerError(fileError instanceof Error ? fileError.message : "Unknown error");
          }
        }
        log.error(`Error fetching document ${documentRelativePath}: ${error}`);
        if (error instanceof BackendError) {
          throw error;
        } else {
          throw new InternalServerError(error instanceof Error ? error.message : "Unknown error");
        }
      }
    });

    // Root-level files endpoint - delegates to service
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:fileName`, async (request, reply) => {
      const { fileName } = request.params as { fileName: string };
      log.info(`Request received for root file: ${fileName}`);

      // Skip if this is a documents route or another known route handled elsewhere
      if (fileName === this.documentsSubDirectory || fileName === ".well-known") {
        return reply.callNotFound();
      }

      try {
        const content = await this.documentService.getFileContent(fileName);

        if (fileName.endsWith(".json")) {
          const contentString = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
          try {
            const jsonData = JSON.parse(contentString);
            return reply.type("application/json").send(jsonData);
          } catch (_parseError) {
            log.warn(`Failed to parse JSON for ${fileName}, returning raw string content with JSON header.`);
            return reply.type("application/json").send(contentString);
          }
        } else {
          // For non-JSON files, send the content directly.
          return reply.send(content);
        }
      } catch (error) {
        log.error(`Error fetching root file ${fileName}: ${error}`);
        // Let the error propagate to the global error handler
        if (error instanceof BackendError) {
          throw error;
        } else {
          throw new InternalServerError(error instanceof Error ? error.message : "Unknown error");
        }
      }
    });

    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:ordId/*`, async (request, reply) => {
      let { ordId } = request.params as { ordId: string };
      const { "*": unknownPath } = request.params as { "*": string };
      log.info(`[ORDID ROUTE] Request received for resource file: ordId=${ordId}, path=${unknownPath}`);

      // Skip if this is a documents route
      if (ordId === this.documentsSubDirectory) {
        return reply.callNotFound();
      }

      let fileName = unknownPath;
      if (!isOrdId(ordId)) {
        const foundOrdId = unknownPath.split("/").find(isOrdId);
        if (foundOrdId) {
          ordId = foundOrdId;
        }
        fileName = unknownPath.split("/").pop()!;
      }

      const resourceMap = this.fqnDocumentMap[ordId]?.find(
        (resource) => resource.fileName === fileName || `/${resource.fileName}` === fileName,
      );

      let relativePath: string;
      if (resourceMap) {
        relativePath = resourceMap.filePath;
      } else {
        if (isOrdId(ordId)) {
          relativePath = joinFilePaths(ordIdToPathSegment(ordId), unknownPath);
        } else {
          relativePath = joinFilePaths(ordId, unknownPath);
        }
      }

      try {
        const content = await this.documentService.getFileContent(relativePath);

        if (relativePath.endsWith(".json")) {
          const contentString = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
          try {
            const jsonData = JSON.parse(contentString);
            return reply.type("application/json").send(jsonData);
          } catch (_parseError) {
            log.warn(`Failed to parse JSON for ${relativePath}, returning raw string content with JSON header.`);
            return reply.type("application/json").send(contentString);
          }
        } else {
          return reply.send(content);
        }
      } catch (error) {
        log.error(`Error fetching resource file ${relativePath}: ${error}`);
        // Let the error propagate to the global error handler
        if (error instanceof BackendError) {
          throw error;
        } else {
          throw new InternalServerError(error instanceof Error ? error.message : "Unknown error");
        }
      }
    });
  }
}
