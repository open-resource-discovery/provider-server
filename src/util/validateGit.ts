import { validateLocalDirectory } from "./validateOptions.js";

/**
 * Validates git-cloned content (post-clone validation)
 *
 * @param directoryPath Path to the cloned git directory
 * @param ordDocumentsSubDirectory Subdirectory name containing ORD documents
 * @throws LocalDirectoryError if validation fails
 */
export function validateGitContent(directoryPath: string, ordDocumentsSubDirectory: string): void {
  // Reuse the local directory validation logic
  validateLocalDirectory(directoryPath, ordDocumentsSubDirectory);
}
