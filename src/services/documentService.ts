import {
  OrdConfiguration,
  OrdDocument,
  ApiResource,
  EventResource,
  OrdV1DocumentDescription,
  SystemVersion,
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
  // Track in-progress loading operations to prevent duplicate cache builds
  private readonly loadingPromises = new Map<string, Promise<void>>();

  // Method to ensure data (config, docs, FQN map) is loaded and cached
  private async ensureDataLoaded(dirHash: string): Promise<void> {
    // Check if config is already cached for this hash, implying data is loaded
    if (this.cacheService.getCachedOrdConfig(dirHash)) {
      return Promise.resolve();
    }

    if (this.cacheService.isWarming()) {
      const warmingHash = this.cacheService.getCurrentHash();
      log.debug(`Cache warming in progress for hash ${warmingHash}, current request hash ${dirHash}`);

      // If warming the same hash or any warming is happening, wait for it
      if (
        warmingHash === dirHash ||
        warmingHash?.startsWith(dirHash.substring(0, 7)) ||
        dirHash.startsWith(warmingHash?.substring(0, 7) || "")
      ) {
        log.debug(`Waiting for cache warming to complete...`);
        await this.cacheService.waitForCompletion();

        // After cache warming completes, check if data was actually cached
        const cachedConfig = this.cacheService.getCachedOrdConfig(dirHash);
        if (cachedConfig) {
          log.debug(`Cache warming completed and data is cached for hash ${dirHash}`);
          return;
        } else {
          log.debug(`Cache warming completed but data not cached for hash ${dirHash}, will load inline`);
        }
      }
    }

    // Check if already loading this hash
    const existingPromise = this.loadingPromises.get(dirHash);
    if (existingPromise) {
      log.debug(`Cache load already in progress for hash ${dirHash}, waiting...`);
      return existingPromise;
    }

    // Only use inline loading if no cache warming is happening
    const loadingPromise = this.loadInline(dirHash).finally(() => {
      this.loadingPromises.delete(dirHash);
    });

    this.loadingPromises.set(dirHash, loadingPromise);
    return loadingPromise;
  }

  // Inline loading for local mode
  private loadInline(dirHash: string): Promise<void> {
    const loadingPromise = (async (): Promise<void> => {
      try {
        log.debug(`Cache miss for hash ${dirHash}. Fetching documents, building config and FQN map.`);
        const documentsMap = await this.repository.getDocuments(this.documentsDirectoryPath);
        const ordConfig: OrdConfiguration = emptyOrdConfig(this.processingContext.baseUrl);
        const accessStrategies = getOrdDocumentAccessStrategies(this.processingContext.authMethods);
        const documentPaths: string[] = [];

        const processedDocsForFqn: OrdDocument[] = [];

        let count = 0;
        for (const [relativePath, document] of documentsMap.entries()) {
          try {
            const processedDoc = this.processDocument(document, dirHash);
            this.cacheService.cacheDocument(relativePath, dirHash, processedDoc);
            documentPaths.push(relativePath);
            processedDocsForFqn.push(processedDoc);

            const documentUrl = joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, relativePath.replace(/\.json$/, ""));
            const perspective = getDocumentPerspective(document);

            const documentEntry: OrdV1DocumentDescription = {
              url: documentUrl,
              accessStrategies,
              perspective,
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ordConfig.openResourceDiscoveryV1.documents?.push(documentEntry as any);
          } catch (error) {
            log.warn(`Error processing document ${relativePath}: ${error}`);
          }

          count++;
          if (count % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
            log.debug(`Processed ${count}/${documentsMap.size} documents`);
          }
        }

        if (ordConfig.openResourceDiscoveryV1.documents?.length === 0) {
          log.warn(`No valid ORD documents found in ${this.documentsDirectoryPath}. Caching empty config/map.`);
        }

        const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(processedDocsForFqn);

        this.cacheService.setCachedOrdConfig(dirHash, ordConfig);
        this.cacheService.setCachedDirectoryDocumentPaths(dirHash, documentPaths);
        this.cacheService.setCachedFqnMap(dirHash, fqnDocumentMap);

        log.info(`Cached config, paths, and FQN map for hash: ${dirHash}`);
      } finally {
        this.loadingPromises.delete(dirHash);
      }
    })();

    this.loadingPromises.set(dirHash, loadingPromise);
    return loadingPromise;
  }

  public constructor(
    private readonly repository: DocumentRepository,
    private readonly cacheService: CacheService,
    private readonly processingContext: ProcessingContext,
    private readonly documentsDirectoryPath: string,
  ) {}

  public async getProcessedDocument(relativePath: string): Promise<OrdDocument> {
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
    const processedDoc = this.processDocument(document, currentDirHash);

    this.cacheService.cacheDocument(relativePath, currentDirHash, processedDoc);

    return processedDoc;
  }

  public async getOrdConfiguration(perspective?: Perspective): Promise<OrdConfiguration> {
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
    const filteredConfig: OrdConfiguration = {
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

  private processDocument(document: OrdDocument, directoryHash: string | null): OrdDocument {
    const eventResources = this.processResourceDefinition(document.eventResources || []);
    const apiResources = this.processResourceDefinition(document.apiResources || []);

    const perspective = getDocumentPerspective(document);

    // Only inject describedSystemVersion for system-version perspective documents that don't have it
    const describedSystemVersion =
      document.describedSystemVersion ||
      (perspective === "system-version" ? this.getDefaultDescribedSystemVersion(directoryHash) : undefined);

    return {
      ...document,
      perspective,
      describedSystemInstance: {
        ...document.describedSystemInstance,
        baseUrl: this.processingContext.baseUrl,
      },
      describedSystemVersion,
      apiResources: apiResources.length ? apiResources : undefined,
      eventResources: eventResources.length ? eventResources : undefined,
    };
  }

  private processResourceDefinition<T extends EventResource | ApiResource>(resources: T[]): T[] {
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

  /**
   * Gets the default described system version.
   *
   * @param directoryHash - The full directory hash from the repository
   * @returns Version in format "1.0.0-<hash>" where hash is the first 8 characters of the directory hash
   */
  private getDefaultDescribedSystemVersion(directoryHash: string | null): SystemVersion {
    const shortHash = directoryHash ? directoryHash.substring(0, 8) : "unknown";
    const version = `1.0.0-${shortHash}`;
    return { version };
  }
}
