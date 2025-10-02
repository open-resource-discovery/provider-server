import { validateLocalDirectory } from "./validateOptions.js";
import { log } from "./logger.js";

/**
 * Validates git-cloned content (post-clone validation)
 *
 * @param directoryPath Path to the cloned git directory
 * @param ordDocumentsSubDirectory Subdirectory name containing ORD documents
 * @throws LocalDirectoryError if validation fails
 */
export function validateGitContent(directoryPath: string, ordDocumentsSubDirectory: string): void {
  log.debug(`Validating git content at ${directoryPath}/${ordDocumentsSubDirectory}`);

  try {
    // Reuse the local directory validation logic
    validateLocalDirectory(directoryPath, ordDocumentsSubDirectory);

    log.debug(`Git content validation successful for ${directoryPath}`);
  } catch (error) {
    log.error(`Git content validation failed for ${directoryPath}: ${error}`);
    throw error;
  }
}
