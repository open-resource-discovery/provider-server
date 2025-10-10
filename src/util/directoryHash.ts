import * as fs from "fs";
import * as crypto from "crypto";
import { getAllFiles } from "./files.js";
import { log } from "./logger.js";

/**
 * Calculate directory hash the same way as LocalDocumentRepository does
 * This ensures cache warming and request-time lookups use the same hash
 */
export async function calculateDirectoryHash(directoryPath: string): Promise<string | null> {
  try {
    // Check if directory exists first
    if (!fs.existsSync(directoryPath)) {
      log.debug(`Directory ${directoryPath} does not exist yet`);
      return null;
    }

    // Simple hash based on file modification times for local directories
    const files = await getAllFiles(directoryPath);

    const hash = crypto.createHash("sha256");
    for (const file of files.sort()) {
      const stats = fs.statSync(file);
      hash.update(file + stats.mtimeMs);
    }

    return hash.digest("hex");
  } catch (error) {
    log.error(`Error calculating hash for directory ${directoryPath}: ${error}`);
    return null;
  }
}
