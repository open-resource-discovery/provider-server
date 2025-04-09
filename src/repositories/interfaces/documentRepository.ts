import { ORDDocument } from "@open-resource-discovery/specification";

export interface DocumentRepository {
  /**
   * Fetches a single ORD document from the source.
   * @param path The path to the document.
   * @returns The ORD document or null if not found.
   */
  getDocument(path: string): Promise<ORDDocument | null>;

  /**
   * Fetches all ORD documents within a specified directory.
   * @param directoryPath The path to the directory containing documents.
   * @returns A map where keys are document paths and values are ORD documents.
   */
  getDocuments(directoryPath: string): Promise<Map<string, ORDDocument>>;

  /**
   * Gets the hash (e.g., SHA) of a directory to detect changes.
   * @param directoryPath The path to the directory.
   * @returns The directory hash or null if unable to determine.
   */
  getDirectoryHash(directoryPath: string): Promise<string | null>;

  /**
   * Lists the paths of all files within a specified directory.
   * @param directoryPath The path to the directory.
   * @param directoryPath The path to the directory.
   * @param recursive Optional flag to control recursion (implementation might ignore it if always recursive).
   * @returns An array of file paths.
   */
  listFiles(directoryPath: string, recursive?: boolean): Promise<string[]>;

  /**
   * Fetches the content of a non-ORD file.
   * @param path The path to the file.
   * @returns The file content as a string or buffer, or null if not found.
   */
  getFileContent(path: string): Promise<string | Buffer | null>;
}
