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
export function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const normalizedDirPath = normalizePath(dirPath);

  // Check if directory exists before trying to read it
  if (!fs.existsSync(normalizedDirPath)) {
    return arrayOfFiles;
  }

  const files = fs.readdirSync(normalizedDirPath);

  files.forEach((file) => {
    const filePath = normalizePath(joinFilePaths(normalizedDirPath, file));

    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, arrayOfFiles);
    } else {
      // Add file to our array
      arrayOfFiles.push(filePath);
    }
  });

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
