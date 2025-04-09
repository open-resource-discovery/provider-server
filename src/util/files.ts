import fs from "fs";
import { normalizePath, joinFilePaths } from "./pathUtils.js";

/**
 * Lists all files recursively from the given directory
 * @param dirPath The directory path to scan
 * @param arrayOfFiles Optional array to accumulate files (used for recursion)
 * @returns Array of file paths
 */
export function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const normalizedDirPath = normalizePath(dirPath);
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
