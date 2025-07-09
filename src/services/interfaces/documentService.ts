import { ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import { FqnDocumentMap } from "../../util/fqnHelpers.js"; // Import FqnDocumentMap
import { Perspective } from "../../model/perspective.js";

export interface DocumentService {
  /**
   * Gets a processed ORD document, handling caching and validation.
   * @param path The path to the document.
   * @returns The processed ORD document.
   * @throws {NotFoundError} If the document is not found or invalid.
   */
  getProcessedDocument(path: string): Promise<ORDDocument>;

  /**
   * Gets the processed ORD configuration, handling caching.
   * @param perspective Optional perspective filter to filter documents by perspective.
   * @returns The processed ORD configuration.
   */
  getOrdConfiguration(perspective?: Perspective): Promise<ORDConfiguration>;

  /**
   * Gets the content of a non-ORD file.
   * @param path The path to the file.
   * @returns The file content.
   * @throws {NotFoundError} If the file is not found.
   */
  getFileContent(path: string): Promise<string | Buffer>;

  /**
   * Gets the FQN (Fully Qualified Name) map for resource routing.
   * Ensures necessary data is loaded/cached before returning.
   * @returns The FQN document map.
   */
  getFqnMap(): Promise<FqnDocumentMap>;
}
