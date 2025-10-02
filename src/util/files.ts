import fs from "fs";
import { normalizePath, joinFilePaths } from "./pathUtils.js";
import { log } from "./logger.js";
import path from "path";

/**
 * Lists all files recursively from the given directory
 * @param dirPath The directory path to scan
 * @param arrayOfFiles Optional array to accumulate files (used for recursion)
 * @returns Array of file paths
 */
export async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): Promise<string[]> {
  const normalizedDirPath = normalizePath(dirPath);

  // Check if directory exists before trying to read it
  try {
    await fs.promises.access(normalizedDirPath);
  } catch {
    return arrayOfFiles;
  }

  const files = await fs.promises.readdir(normalizedDirPath);

  await Promise.all(
    files.map(async (file) => {
      const filePath = normalizePath(joinFilePaths(normalizedDirPath, file));

      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        await getAllFiles(filePath, arrayOfFiles);
      } else {
        // Add file to our array
        arrayOfFiles.push(filePath);
      }
    }),
  );

  return arrayOfFiles;
}

// Helper to get package.json version
export function getPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || "unknown";
  } catch (error) {
    log.error("Failed to read package.json version: %s", error);
    return "unknown";
  }
}
