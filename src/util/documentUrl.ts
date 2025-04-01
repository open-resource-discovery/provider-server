import path from "path";
import { PATH_CONSTANTS } from "../constant.js";
import { joinFilePaths, joinUrlPaths } from "./pathUtils.js";

/**
 * Creates a document URL path from a root path and file path
 * @param rootPath The root directory path
 * @param file The full file path
 * @returns URL path for the document
 */
export function getOrdDocumentPath(rootPath: string, file: string): string {
  return joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, getEncodedFilePath(rootPath, file));
}

/**
 * Creates an encoded file path relative to the root path
 * @param rootPath The root directory path
 * @param file The full file path
 * @returns Encoded file path
 */
export function getEncodedFilePath(rootPath: string, file: string): string {
  const relativeFilePath = path.posix.relative(rootPath, file);
  const { dir, name } = path.posix.parse(relativeFilePath);
  const encodedFileName = encodeURIComponent(name);
  return joinFilePaths(dir, encodedFileName);
}
