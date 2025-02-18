import { APIResource, EventResource, ORDDocument, ORDConfiguration } from "@sap/open-resource-discovery";
import path from "path";
import fs from "fs";
import { OptAuthMethod } from "src/model/cli.js";
import { getOrdDocumentAccessStrategies } from "src/util/ordConfig.js";
import { log } from "src/util/logger.js";
import { getAllFiles } from "src/util/files.js";
import { ORD_DOCUMENTS_SUB_DIRECTORY, ORD_SERVER_PREFIX_PATH } from "src/constant.js";

interface DocumentCache {
  [key: string]: ORDDocument;
}

export interface ProcessingContext {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepo?: string;
  githubToken?: string;
}

export class OrdDocumentProcessor {
  private static documentCache: DocumentCache = {};

  // processResourceDefinition will parse URLs of resource definitions and apply given access strategy
  private static processResourceDefinition<T extends EventResource | APIResource>(
    authMethods: OptAuthMethod[],
    resources: T[],
  ): T[] {
    return resources.map((resource) => ({
      ...resource,
      resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => ({
        ...definition,
        ...(definition.url && { url: this.fixUrl(definition.url) }),
        accessStrategies: getOrdDocumentAccessStrategies(authMethods),
      })),
    }));
  }

  private static fixUrl(url: string): string {
    if (this.isRemoteUrl(url)) {
      return url;
    }
    return path.posix.join(ORD_SERVER_PREFIX_PATH, path.posix.resolve("/", url));
  }

  private static isRemoteUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
  }

  private static updateResources(context: ProcessingContext, document: ORDDocument): ORDDocument {
    const eventResources = this.processResourceDefinition(context.authMethods, document.eventResources || []);
    const apiResources = this.processResourceDefinition(context.authMethods, document.apiResources || []);

    return {
      ...document,
      describedSystemInstance: {
        ...document.describedSystemInstance,
        baseUrl: context.baseUrl,
      },
      apiResources: apiResources.length ? apiResources : undefined,
      eventResources: eventResources.length ? eventResources : undefined,
    };
  }

  public static processGithubDocument(
    context: ProcessingContext,
    cacheKey: string,
    document: ORDDocument,
  ): ORDDocument {
    if (this.documentCache[cacheKey]) {
      return this.documentCache[cacheKey];
    }

    const processedDocument = this.updateResources(context, document);
    this.documentCache[cacheKey] = processedDocument;
    return processedDocument;
  }

  public static processLocalDocuments(
    context: ProcessingContext,
    ordConfig: ORDConfiguration,
    ordDirectory: string,
  ): { [relativeFilePath: string]: ORDDocument } {
    const ordDocuments: { [relativeFilePath: string]: ORDDocument } = {};
    const ordDocumentDirectoryPath = `${ordDirectory.replace(/\/$/, "")}/${ORD_DOCUMENTS_SUB_DIRECTORY}`;
    const ordFiles = getAllFiles(ordDocumentDirectoryPath);

    if (ordFiles.length === 0) {
      throw new Error(`No ORD documents found in ${ordDocumentDirectoryPath}.`);
    }

    for (const file of ordFiles) {
      if (!file.endsWith(".json")) {
        log.warn(`Only .json file extensions are supported. Skipping ${file}`);
        continue;
      }
      const relativeFilePath = path.posix.relative(ordDirectory, file);
      const filePathParsed = path.posix.parse(relativeFilePath);
      const encodedFileName = encodeURIComponent(filePathParsed.name);
      const relativeUrl = `${ORD_SERVER_PREFIX_PATH}/${ORD_DOCUMENTS_SUB_DIRECTORY}/${encodedFileName}`;

      try {
        const ordDocumentText = fs.readFileSync(file).toString();
        const ordDocumentParsed = JSON.parse(ordDocumentText) as ORDDocument;

        if (!ordDocumentParsed.openResourceDiscovery) {
          log.warn(`Invalid ORD document found in ${file}`);
          continue;
        }

        log.info(`>> Served: ${context.baseUrl}${relativeUrl}`);

        ordConfig.openResourceDiscoveryV1.documents?.push({
          url: relativeUrl,
          accessStrategies: getOrdDocumentAccessStrategies(context.authMethods),
        });

        const processedDocument = this.updateResources(context, ordDocumentParsed);
        ordDocuments[encodedFileName] = processedDocument;
      } catch (error) {
        log.error(`Error processing file ${file}: ${error}`);
      }
    }

    if (Object.keys(ordDocuments).length === 0) {
      throw new Error(`No valid ORD documents found in ${ordDocumentDirectoryPath}.`);
    }

    return ordDocuments;
  }
}
