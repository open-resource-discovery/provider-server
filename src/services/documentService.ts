import {
  ORDConfiguration,
  ORDDocument,
  APIResource,
  EventResource,
  ORDV1DocumentDescription,
} from "@open-resource-discovery/specification";
import { DocumentService as DocumentServiceInterface } from "./interfaces/documentService.js";
import { DocumentRepository } from "../repositories/interfaces/documentRepository.js";
import { CacheService } from "./interfaces/cacheService.js";
import { ProcessingContext } from "./interfaces/processingContext.js";
import { NotFoundError } from "../model/error/NotFoundError.js";
import { log } from "../util/logger.js";
import { getOrdDocumentAccessStrategies, emptyOrdConfig } from "../util/ordConfig.js";
import { ordIdToPathSegment, joinUrlPaths } from "../util/pathUtils.js";
import path from "path";
import { PATH_CONSTANTS } from "../constant.js";
import { FqnDocumentMap, getFlattenedOrdFqnDocumentMap } from "../util/fqnHelpers.js";
import { getDocumentPerspective, Perspective } from "../model/perspective.js";

export class DocumentService implements DocumentServiceInterface {
  // Method to ensure data (config, docs, FQN map) is loaded and cached
  private async ensureDataLoaded(dirHash: string): Promise<void> {
    // Check if config is already cached for this hash, implying data is loaded
    if (this.cacheService.getCachedOrdConfig(dirHash)) {
      return;
    }

    log.debug(`Cache miss for hash ${dirHash}. Fetching documents, building config and FQN map.`);
    const documentsMap = await this.repository.getDocuments(this.documentsDirectoryPath);
    const ordConfig: ORDConfiguration = emptyOrdConfig(this.processingContext.baseUrl);
    const accessStrategies = getOrdDocumentAccessStrategies(this.processingContext.authMethods);
    const documentPaths: string[] = [];
    const processedDocsForFqn: ORDDocument[] = [];

    for (const [relativePath, document] of documentsMap.entries()) {
      try {
        const processedDoc = this.processDocument(document);
        this.cacheService.cacheDocument(relativePath, dirHash, processedDoc);
        documentPaths.push(relativePath);
        processedDocsForFqn.push(processedDoc);

        const documentUrl = joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, relativePath.replace(/\.json$/, ""));
        const perspective = getDocumentPerspective(document);

        // Create the document entry with perspective
        const documentEntry: ORDV1DocumentDescription = {
          url: documentUrl,
          accessStrategies,
          perspective,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ordConfig.openResourceDiscoveryV1.documents?.push(documentEntry as any);
      } catch (error) {
        log.warn(`Error processing document ${relativePath}: ${error}`);
      }
    }

    // Generate FQN map
    const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(processedDocsForFqn);

    if (ordConfig.openResourceDiscoveryV1.documents?.length === 0) {
      log.warn(`No valid ORD documents found in ${this.documentsDirectoryPath}. Caching empty config/map.`);
    }

    // Cache everything associated with this hash
    this.cacheService.setCachedOrdConfig(dirHash, ordConfig);
    this.cacheService.setCachedDirectoryDocumentPaths(dirHash, documentPaths);
    this.cacheService.setCachedFqnMap(dirHash, fqnDocumentMap);
    log.info(`Cached config, paths, and FQN map for hash: ${dirHash}`);
  }

  public constructor(
    private readonly repository: DocumentRepository,
    private readonly cacheService: CacheService,
    private readonly processingContext: ProcessingContext,
    private readonly documentsDirectoryPath: string,
  ) {}

  public async getProcessedDocument(relativePath: string): Promise<ORDDocument> {
    log.debug(`Getting processed document for path: ${relativePath}`);
    const currentDirHash = await this.repository.getDirectoryHash(this.documentsDirectoryPath);

    if (!currentDirHash) {
      throw new Error(`Could not get directory hash for ${this.documentsDirectoryPath}`);
    }

    // Check cache first
    const cachedDoc = this.cacheService.getDocumentFromCache(relativePath, currentDirHash);
    if (cachedDoc) {
      return cachedDoc;
    }

    // If cache miss or hash changed, fetch from repository
    log.debug(`Cache miss or hash changed for document: ${relativePath}. Fetching from repository.`);
    const document = await this.repository.getDocument(relativePath);

    if (!document) {
      throw new NotFoundError(`Document not found or invalid at path: ${relativePath}`, relativePath);
    }

    // Process the document (apply base URL, access strategies, etc.)
    const processedDoc = this.processDocument(document);

    this.cacheService.cacheDocument(relativePath, currentDirHash, processedDoc);

    return processedDoc;
  }

  public async getOrdConfiguration(perspective?: Perspective): Promise<ORDConfiguration> {
    log.debug(`Getting ORD configuration${perspective ? ` with perspective filter: ${perspective}` : ""}`);
    const currentDirHash = await this.repository.getDirectoryHash(this.documentsDirectoryPath);

    if (!currentDirHash) {
      throw new Error(`Could not get directory hash for ${this.documentsDirectoryPath}`);
    }

    // Ensure data is loaded for the current hash
    await this.ensureDataLoaded(currentDirHash);

    // Retrieve the now-cached config
    const config = this.cacheService.getCachedOrdConfig(currentDirHash);
    if (!config) {
      log.error(`Failed to retrieve cached config for hash ${currentDirHash} after loading.`);
      throw new Error("Failed to load ORD configuration.");
    }

    // If no perspective filter, return the full config
    if (!perspective) {
      return config;
    }

    // Filter documents by perspective
    const filteredConfig: ORDConfiguration = {
      ...config,
      openResourceDiscoveryV1: {
        ...config.openResourceDiscoveryV1,
        documents:
          config.openResourceDiscoveryV1.documents?.filter((doc) => {
            return doc.perspective === perspective;
          }) || [],
      },
    };

    return filteredConfig;
  }

  public async getFileContent(relativePath: string): Promise<string | Buffer> {
    log.debug(`Getting file content for path: ${relativePath}`);
    const content = await this.repository.getFileContent(relativePath);
    if (content === null) {
      throw new NotFoundError(`File not found at path: ${relativePath}`);
    }
    return content;
  }

  // Method to get the FQN map, ensuring data is loaded first
  public async getFqnMap(): Promise<FqnDocumentMap> {
    log.debug(`Getting FQN map`);
    const currentDirHash = await this.repository.getDirectoryHash(this.documentsDirectoryPath);
    if (!currentDirHash) {
      throw new Error(`Could not get directory hash for ${this.documentsDirectoryPath}`);
    }

    // Ensure data is loaded for the current hash
    await this.ensureDataLoaded(currentDirHash);

    const map = this.cacheService.getCachedFqnMap(currentDirHash);
    if (!map) {
      // Should not happen if ensureDataLoaded worked correctly
      log.error(`Failed to retrieve cached FQN map for hash ${currentDirHash} after loading.`);
      throw new Error("Failed to load FQN map.");
    }
    return map;
  }

  private processDocument(document: ORDDocument): ORDDocument {
    const eventResources = this.processResourceDefinition(document.eventResources || []);
    const apiResources = this.processResourceDefinition(document.apiResources || []);

    return {
      ...document,
      perspective: getDocumentPerspective(document),
      describedSystemInstance: {
        ...document.describedSystemInstance,
        baseUrl: this.processingContext.baseUrl,
      },
      apiResources: apiResources.length ? apiResources : undefined,
      eventResources: eventResources.length ? eventResources : undefined,
    };
  }

  private processResourceDefinition<T extends EventResource | APIResource>(resources: T[]): T[] {
    return resources.map((resource) => ({
      ...resource,
      resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => {
        return {
          ...definition,
          ...(definition.url && { url: this.fixUrl(definition.url, resource.ordId) }),
          accessStrategies: getOrdDocumentAccessStrategies(this.processingContext.authMethods),
        };
      }),
    }));
  }

  private fixUrl(url: string, ordId: string): string {
    const escapedOrdId = ordIdToPathSegment(ordId);
    const pathParts = url.split("/");
    const ordIdIdx = pathParts.findIndex((part) => escapedOrdId === part);

    if (ordIdIdx > -1) {
      pathParts[ordIdIdx] = ordId;
    }

    const urlWithFixedOrdId = pathParts.join("/");

    if (this.isRemoteUrl(url)) {
      return urlWithFixedOrdId;
    }
    // Construct server-relative URL
    return joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, path.posix.resolve("/", urlWithFixedOrdId));
  }

  private isRemoteUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
  }
}
