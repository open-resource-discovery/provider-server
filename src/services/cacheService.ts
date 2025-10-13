import * as fs from "fs/promises";
import * as path from "path";
import {
  OrdConfiguration,
  OrdDocument,
  ApiResource,
  EventResource,
  OrdV1DocumentDescription,
  SystemVersion,
} from "@open-resource-discovery/specification";
import { CacheService as CacheServiceInterface } from "./interfaces/cacheService.js";
import { log } from "../util/logger.js";
import { FqnDocumentMap, getFlattenedOrdFqnDocumentMap } from "../util/fqnHelpers.js";
import { ProcessingContext } from "./interfaces/processingContext.js";
import { Logger } from "pino";
import { getAllFiles } from "../util/files.js";
import { validateOrdDocument } from "../util/validateOrdDocument.js";
import { emptyOrdConfig, getOrdDocumentAccessStrategies } from "../util/ordConfig.js";
import { ordIdToPathSegment, joinUrlPaths } from "../util/pathUtils.js";
import { PATH_CONSTANTS } from "../constant.js";
import { getDocumentPerspective } from "../model/perspective.js";

export class CacheService implements CacheServiceInterface {
  // Cache for individual documents, keyed by their full path
  private readonly documentCache: Map<string, OrdDocument> = new Map();
  // Cache for ORD configurations, keyed by directory hash
  private readonly configCache: Map<string, OrdConfiguration> = new Map();
  // Cache mapping directory hash to the list of document paths it contains
  private readonly dirDocumentPathsCache: Map<string, string[]> = new Map();
  // Cache for FQN maps, keyed by directory hash
  private readonly fqnMapCache: Map<string, FqnDocumentMap> = new Map();
  // Store the last known hash for each directory path to detect changes
  private readonly lastKnownDirHashMap: Map<string, string> = new Map();

  private currentWarmingPromise: Promise<void> | null = null;
  private currentDirHash: string | null = null;
  private abortController: AbortController | null = null;
  private readonly processingContext: ProcessingContext | null;
  private readonly logger: Logger;

  public constructor(processingContext?: ProcessingContext, logger?: Logger) {
    this.processingContext = processingContext || null;
    this.logger = logger || log;
  }

  /**
   * Retrieves a cached ORD document only if the directory hash matches
   * and the document path is associated with that hash.
   */
  public getDocumentFromCache(path: string, dirHash: string): OrdDocument | null {
    const cachedPaths = this.dirDocumentPathsCache.get(dirHash);
    if (cachedPaths && cachedPaths.includes(path)) {
      const doc = this.documentCache.get(path);
      if (doc) {
        log.debug(`Cache hit for document: ${path} with hash: ${dirHash}`);
        return doc;
      }
    }
    log.debug(`Cache miss for document: ${path} with hash: ${dirHash}`);
    return null;
  }

  /**
   * Caches an ORD document and associates its path with the directory hash.
   */
  public cacheDocument(path: string, dirHash: string, document: OrdDocument): void {
    this.documentCache.set(path, document);

    // Ensure the path is associated with the directory hash
    const paths = this.dirDocumentPathsCache.get(dirHash) || [];
    if (!paths.includes(path)) {
      paths.push(path);
      this.dirDocumentPathsCache.set(dirHash, paths);
    }
  }

  /**
   * Retrieves the cached ORD configuration for a given directory hash.
   */
  public getCachedOrdConfig(dirHash: string): OrdConfiguration | null {
    const config = this.configCache.get(dirHash);
    if (config) {
      log.debug(`Cache hit for ORD config with hash: ${dirHash}`);
      return config;
    }
    log.debug(`Cache miss for ORD config with hash: ${dirHash}`);
    return null;
  }

  /**
   * Caches the ORD configuration associated with a directory hash.
   */
  public setCachedOrdConfig(dirHash: string, config: OrdConfiguration): void {
    this.configCache.set(dirHash, config);
  }

  /**
   * Retrieves the cached list of document paths for a given directory hash.
   */
  public getCachedDirectoryDocumentPaths(dirHash: string): string[] | null {
    const paths = this.dirDocumentPathsCache.get(dirHash);
    if (paths) {
      log.debug(`Cache hit for document paths with hash: ${dirHash}`);
      return paths;
    }
    log.debug(`Cache miss for document paths with hash: ${dirHash}`);
    return null;
  }

  /**
   * Caches the list of document paths associated with a directory hash.
   */
  public setCachedDirectoryDocumentPaths(dirHash: string, paths: string[]): void {
    this.dirDocumentPathsCache.set(dirHash, paths);
  }

  /**
   * Retrieves the cached FQN map for a given directory hash.
   * @param dirHash The hash of the directory.
   * @returns The cached FQN map or null if not found.
   */
  public getCachedFqnMap(dirHash: string): FqnDocumentMap | null {
    const map = this.fqnMapCache.get(dirHash);
    if (map) {
      log.debug(`Cache hit for FQN map with hash: ${dirHash}`);
      return map;
    }
    log.debug(`Cache miss for FQN map with hash: ${dirHash}`);
    return null;
  }

  /**
   * Caches the FQN map associated with a directory hash.
   * @param dirHash The hash of the directory.
   * @param map The FQN map to cache.
   */
  public setCachedFqnMap(dirHash: string, map: FqnDocumentMap): void {
    this.fqnMapCache.set(dirHash, map);
  }

  /**
   * Checks if the directory hash has changed since the last check.
   * If it has changed, invalidates the cache for the old hash.
   * @param directoryPath The path of the directory (used to track the last hash).
   * @param currentDirHash The current hash of the directory.
   * @returns True if the hash has changed, false otherwise.
   */
  public hasDirectoryHashChanged(directoryPath: string, currentDirHash: string): boolean {
    const lastHash = this.lastKnownDirHashMap.get(directoryPath);
    if (lastHash && lastHash !== currentDirHash) {
      log.info(`Directory hash changed for ${directoryPath}. Invalidating cache for old hash: ${lastHash}`);
      this.invalidateCacheForDirectory(lastHash);
      this.lastKnownDirHashMap.set(directoryPath, currentDirHash);
      return true;
    } else if (!lastHash) {
      this.lastKnownDirHashMap.set(directoryPath, currentDirHash);
      // Treat first time seeing hash as unchanged for caching purposes
      return false;
    }
    return false;
  }

  /**
   * Invalidates the cache associated with a specific directory hash.
   * Removes the config, the list of paths, and all associated documents.
   */
  public invalidateCacheForDirectory(dirHash: string): void {
    log.info(`Invalidating cache for directory hash: ${dirHash}`);
    const pathsToRemove = this.dirDocumentPathsCache.get(dirHash);

    if (pathsToRemove) {
      pathsToRemove.forEach((path) => {
        this.documentCache.delete(path);
      });
    }

    this.configCache.delete(dirHash);
    this.dirDocumentPathsCache.delete(dirHash);
    this.fqnMapCache.delete(dirHash); // Also clear FQN map

    // Also remove the hash from the tracking map
    for (const [dirPath, hash] of this.lastKnownDirHashMap.entries()) {
      if (hash === dirHash) {
        this.lastKnownDirHashMap.delete(dirPath);
        break;
      }
    }
  }

  /**
   * Clears the entire cache.
   */
  public clearCache(): void {
    log.info("Clearing all caches");
    this.documentCache.clear();
    this.configCache.clear();
    this.dirDocumentPathsCache.clear();
    this.fqnMapCache.clear();
    this.lastKnownDirHashMap.clear();
  }

  /**
   * Warm the cache by processing all documents in the background
   * @param documentsFullPath Absolute path to documents directory
   * @param dirHash Directory hash for cache key
   * @param documentsSubDirectory Subdirectory name to prepend to relative paths (e.g., "documents")
   * @returns Promise that resolves when warming is complete
   */
  public async warmCache(documentsFullPath: string, dirHash: string, documentsSubDirectory?: string): Promise<void> {
    if (!this.processingContext) {
      this.logger.debug("Cache warming not available in local mode");
      return Promise.resolve();
    }

    if (this.getCachedOrdConfig(dirHash)) {
      this.logger.debug(`Cache already warm for hash ${dirHash}`);
      return Promise.resolve();
    }

    // If already warming this exact hash, return existing promise
    if (this.currentDirHash === dirHash && this.currentWarmingPromise) {
      this.logger.debug(`Cache warming already in progress for hash ${dirHash}, waiting...`);
      return this.currentWarmingPromise;
    }

    // If warming a different hash, wait for it to complete first
    if (this.currentWarmingPromise && this.currentDirHash !== dirHash) {
      this.logger.debug(
        `Cache warming in progress for different hash ${this.currentDirHash}, waiting for completion...`,
      );
      await this.currentWarmingPromise.catch(() => {});
    }

    this.logger.info(`Starting cache warming for hash ${dirHash}`);
    this.currentDirHash = dirHash;
    this.abortController = new AbortController();
    this.currentWarmingPromise = this.executeWarming(
      documentsFullPath,
      dirHash,
      documentsSubDirectory || "",
      this.abortController.signal,
    );

    return this.currentWarmingPromise;
  }

  private async executeWarming(
    documentsFullPath: string,
    dirHash: string,
    documentsSubDirectory: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const baseUrl = this.processingContext!.baseUrl;
      const authMethods = this.processingContext!.authMethods;

      const allFiles = await getAllFiles(documentsFullPath);
      const jsonFiles = allFiles.filter((file) => file.endsWith(".json"));

      this.logger.info(`Cache warming: processing ${jsonFiles.length} documents`);

      const documents: { relativePath: string; document: OrdDocument }[] = [];
      const processedDocsForFqn: OrdDocument[] = [];
      const ordConfig: OrdConfiguration = emptyOrdConfig(baseUrl);
      const accessStrategies = getOrdDocumentAccessStrategies(authMethods);
      const documentPaths: string[] = [];

      let processed = 0;

      for (const filePath of jsonFiles) {
        // Check if warming was cancelled
        if (signal.aborted) {
          this.logger.info("Cache warming cancelled");
          return;
        }
        try {
          // Read and parse document
          const content = await fs.readFile(filePath, "utf-8");
          const jsonData = JSON.parse(content);

          // Validate as ORD document
          if (jsonData && jsonData.openResourceDiscovery) {
            validateOrdDocument(jsonData as OrdDocument);

            // Calculate relative path
            // Prepend documentsSubDirectory to match the path structure expected by URLs
            const fileRelativePath = path.relative(documentsFullPath, filePath).split(path.sep).join(path.posix.sep);
            const relativePath = documentsSubDirectory
              ? path.posix.join(documentsSubDirectory, fileRelativePath)
              : fileRelativePath;

            // Process the document
            const processedDoc = this.processDocument(jsonData as OrdDocument, dirHash);

            documents.push({
              relativePath,
              document: processedDoc,
            });

            documentPaths.push(relativePath);
            processedDocsForFqn.push(processedDoc);

            // Add to ORD config
            const documentUrl = joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, relativePath.replace(/\.json$/, ""));
            const perspective = getDocumentPerspective(jsonData as OrdDocument);

            const documentEntry: OrdV1DocumentDescription = {
              url: documentUrl,
              accessStrategies,
              perspective,
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ordConfig.openResourceDiscoveryV1.documents?.push(documentEntry as any);
          }
        } catch (_error) {
          // Skip invalid documents but continue processing other files
        }

        processed++;

        // Log progress every 100 documents or on last document (reduce log noise)
        if (processed % 100 === 0 || processed === jsonFiles.length) {
          this.logger.info(`Cache warming progress: ${processed}/${jsonFiles.length} documents processed`);
        }

        // Check abort signal more frequently for responsiveness
        if (processed % 10 === 0 && signal.aborted) {
          this.logger.info("Cache warming cancelled");
          return;
        }
      }

      // Build FQN map
      const fqnMap = getFlattenedOrdFqnDocumentMap(processedDocsForFqn);

      // Update cache with results
      for (const { relativePath, document } of documents) {
        this.cacheDocument(relativePath, dirHash, document);
      }
      this.setCachedOrdConfig(dirHash, ordConfig);
      this.setCachedDirectoryDocumentPaths(dirHash, documentPaths);
      this.setCachedFqnMap(dirHash, fqnMap);

      this.logger.info(
        `Cache warming completed: ${documents.length} documents cached for hash ${dirHash.substring(0, 8)}`,
      );
    } catch (error) {
      // Only log error if not aborted
      if (!signal.aborted) {
        this.logger.error(`Cache warming failed: ${error}`);
        throw error;
      }
    } finally {
      this.currentWarmingPromise = null;
      this.currentDirHash = null;
      this.abortController = null;
    }
  }

  private processDocument(document: OrdDocument, directoryHash: string): OrdDocument {
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
        baseUrl: this.processingContext?.baseUrl,
      },
      describedSystemVersion,
      apiResources: apiResources.length ? apiResources : undefined,
      eventResources: eventResources.length ? eventResources : undefined,
    };
  }

  private processResourceDefinition<T extends EventResource | ApiResource>(resources: T[]): T[] {
    const accessStrategies = getOrdDocumentAccessStrategies(this.processingContext?.authMethods || []);

    return resources.map((resource) => ({
      ...resource,
      resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => {
        return {
          ...definition,
          ...(definition.url && { url: this.fixUrl(definition.url, resource.ordId) }),
          accessStrategies,
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

  private getDefaultDescribedSystemVersion(directoryHash: string): SystemVersion {
    const shortHash = directoryHash ? directoryHash.substring(0, 8) : "unknown";
    const version = `1.0.0-${shortHash}`;
    return { version };
  }

  /**
   * Cancel any in-progress cache warming operation
   */
  public async cancelWarming(): Promise<void> {
    if (this.abortController) {
      this.logger.info("Cancelling cache warming...");
      this.abortController.abort();

      // Wait for the warming to actually stop
      if (this.currentWarmingPromise) {
        await this.currentWarmingPromise.catch(() => {});
      }

      this.abortController = null;
      this.currentWarmingPromise = null;
      this.currentDirHash = null;
    }
  }

  /**
   * Check if cache warming is currently in progress
   */
  public isWarming(): boolean {
    return this.currentWarmingPromise !== null;
  }

  /**
   * Get the hash currently being warmed (if any)
   */
  public getCurrentHash(): string | null {
    return this.currentDirHash;
  }

  /**
   * Wait for current warming operation to complete
   * Returns immediately if not currently warming
   */
  public waitForCompletion(): Promise<void> {
    if (this.currentWarmingPromise) {
      return this.currentWarmingPromise;
    }
    return Promise.resolve();
  }

  /**
   * Clean up any in-progress cache warming
   */
  public destroy(): void {
    this.currentWarmingPromise = null;
    this.currentDirHash = null;
  }
}
