import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import { FqnDocumentMap } from "../../util/fqnHelpers.js"; // Import FqnDocumentMap

export interface CacheService {
  /**
   * Retrieves a cached ORD document based on its path and the directory hash.
   * @param path The path of the document.
   * @param dirHash The hash of the directory containing the document.
   * @returns The cached ORD document or null if not found or hash mismatch.
   */
  getDocumentFromCache(path: string, dirHash: string): ORDDocument | null;

  /**
   * Caches an ORD document with its path and associated directory hash.
   * @param path The path of the document.
   * @param dirHash The hash of the directory.
   * @param document The ORD document to cache.
   */
  cacheDocument(path: string, dirHash: string, document: ORDDocument): void;

  /**
   * Retrieves the cached ORD configuration for a given directory hash.
   * @param dirHash The hash of the directory.
   * @returns The cached ORD configuration or null if not found.
   */
  getCachedOrdConfig(dirHash: string): ORDConfiguration | null;

  /**
   * Caches the ORD configuration associated with a directory hash.
   * @param dirHash The hash of the directory.
   * @param config The ORD configuration to cache.
   */
  setCachedOrdConfig(dirHash: string, config: ORDConfiguration): void;

  /**
   * Retrieves the cached list of document paths for a given directory hash.
   * @param dirHash The hash of the directory.
   * @returns An array of document paths or null if not found.
   */
  getCachedDirectoryDocumentPaths(dirHash: string): string[] | null;

  /**
   * Caches the list of document paths associated with a directory hash.
   * @param dirHash The hash of the directory.
   * @param paths An array of document paths.
   */
  setCachedDirectoryDocumentPaths(dirHash: string, paths: string[]): void;

  /**
   * Retrieves the cached FQN map for a given directory hash.
   * @param dirHash The hash of the directory.
   * @returns The cached FQN map or null if not found.
   */
  getCachedFqnMap(dirHash: string): FqnDocumentMap | null;

  /**
   * Caches the FQN map associated with a directory hash.
   * @param dirHash The hash of the directory.
   * @param map The FQN map to cache.
   */
  setCachedFqnMap(dirHash: string, map: FqnDocumentMap): void;

  /**
   * Invalidates the cache associated with a specific directory hash.
   * @param dirHash The hash of the directory to invalidate.
   */
  invalidateCacheForDirectory(dirHash: string): void;

  /**
   * Clears the entire cache.
   */
  clearCache(): void;

  /**
   * Warm the cache by processing all documents in the background (GitHub mode only).
   * @param documentsFullPath Absolute path to documents directory.
   * @param dirHash Directory hash for cache key.
   * @param documentsSubDirectory Subdirectory name to prepend to relative paths (e.g., "documents").
   * @returns Promise that resolves when warming is complete.
   */
  warmCache(documentsFullPath: string, dirHash: string, documentsSubDirectory?: string): Promise<void>;

  /**
   * Check if cache warming is currently in progress.
   * @returns True if warming is in progress, false otherwise.
   */
  isWarming(): boolean;

  /**
   * Get the hash currently being warmed (if any).
   * @returns The directory hash being warmed, or null if not warming.
   */
  getCurrentHash(): string | null;

  /**
   * Wait for current warming operation to complete.
   * Returns immediately if not currently warming.
   * @returns Promise that resolves when warming completes.
   */
  waitForCompletion(): Promise<void>;

  /**
   * Cancel any in-progress cache warming operation.
   * @returns Promise that resolves when cancellation is complete.
   */
  cancelWarming(): Promise<void>;

  /**
   * Terminate the worker and clean up resources.
   */
  destroy(): void;
}
