import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import { CacheService as CacheServiceInterface } from "./interfaces/cacheService.js";
import { log } from "../util/logger.js";
import { FqnDocumentMap } from "../util/fqnHelpers.js";

export class CacheService implements CacheServiceInterface {
  // Cache for individual documents, keyed by their full path
  private readonly documentCache: Map<string, ORDDocument> = new Map();
  // Cache for ORD configurations, keyed by directory hash
  private readonly configCache: Map<string, ORDConfiguration> = new Map();
  // Cache mapping directory hash to the list of document paths it contains
  private readonly dirDocumentPathsCache: Map<string, string[]> = new Map();
  // Cache for FQN maps, keyed by directory hash
  private readonly fqnMapCache: Map<string, FqnDocumentMap> = new Map();
  // Store the last known hash for each directory path to detect changes
  private readonly lastKnownDirHashMap: Map<string, string> = new Map();

  /**
   * Retrieves a cached ORD document only if the directory hash matches
   * and the document path is associated with that hash.
   */
  public getDocumentFromCache(path: string, dirHash: string): ORDDocument | null {
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
  public cacheDocument(path: string, dirHash: string, document: ORDDocument): void {
    log.debug(`Caching document: ${path} with hash: ${dirHash}`);
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
  public getCachedOrdConfig(dirHash: string): ORDConfiguration | null {
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
  public setCachedOrdConfig(dirHash: string, config: ORDConfiguration): void {
    log.debug(`Caching ORD config with hash: ${dirHash}`);
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
    log.debug(`Caching document paths for hash: ${dirHash}`);
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
    log.debug(`Caching FQN map with hash: ${dirHash}`);
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
}
