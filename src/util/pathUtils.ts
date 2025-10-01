import path from "path";
import { PATH_CONSTANTS } from "../constant.js";

/**
 * Normalizes a filesystem path to use posix-style separators
 * @param filePath The path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Joins URL path segments ensuring proper formatting
 * @param segments Path segments to join
 * @returns Properly formatted URL path
 */
export function joinUrlPaths(...segments: string[]): string {
  const joined = segments
    .map((segment) => segment.replace(/^\/|\/$/g, "")) // Remove leading/trailing slashes
    .filter(Boolean) // Remove empty segments
    .join("/");

  return joined.startsWith("/") ? joined : `/${joined}`;
}

/**
 * Joins filesystem path segments using posix style
 * @param segments Path segments to join
 * @returns Properly formatted filesystem path
 */
export function joinFilePaths(...segments: string[]): string {
  return path.posix.join(...segments);
}

/**
 * Converts an ORD ID to a filesystem-safe path segment
 * @param ordId The ORD ID to convert
 * @returns Filesystem-safe path segment
 */
export function ordIdToPathSegment(ordId: string): string {
  return ordId.replace(/:/g, "_");
}

/**
 * Converts a filesystem path segment back to an ORD ID
 * @param pathSegment The path segment to convert
 * @returns Original ORD ID
 */
export function pathSegmentToOrdId(pathSegment: string): string {
  return pathSegment.replace(/_/g, ":");
}

/**
 * Creates a document URL path from a root path and file path
 * @param rootPath The root directory path
 * @param filePath The full file path
 * @returns URL path for the document
 */
export function createDocumentUrlPath(rootPath: string, filePath: string): string {
  const relativePath = path.posix.relative(rootPath, filePath);
  const { dir, name } = path.posix.parse(relativePath);
  const encodedFileName = encodeURIComponent(name);
  return joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, dir, encodedFileName);
}

/**
 * Creates a resource URL path from an ORD ID and resource path
 * @param ordId The ORD ID
 * @param resourcePath The resource path
 * @returns URL path for the resource
 */
export function createResourceUrlPath(ordId: string, resourcePath: string): string {
  return joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, ordId, resourcePath);
}

/**
 * Determines if a URL is a remote URL (http/https)
 * @param url The URL to check
 * @returns True if the URL is remote
 */
export function isRemoteUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Extracts the file name from a path
 * @param filePath The file path
 * @returns The file name without extension
 */
export function getFileName(filePath: string): string {
  return path.posix.parse(filePath).name;
}

/**
 * Gets the directory name from a path
 * @param filePath The file path
 * @returns The directory name
 */
export function getDirName(filePath: string): string {
  return path.posix.dirname(filePath);
}

/**
 * Trims leading and trailing slashes from a string
 * @param str The string to trim
 * @returns The string without leading or trailing slashes, or undefined if input is undefined
 */
export function trimLeadingAndTrailingSlashes(str: string | undefined): string | undefined {
  if (str === undefined) return undefined;
  return str.replace(/^\/|\/$/g, "");
}

/**
 * Trims trailing slash from a string
 * @param str The string to trim
 * @returns The string without trailing slash, or undefined if input is undefined
 */
export function trimTrailingSlash(str: string | undefined): string | undefined {
  if (str === undefined) return undefined;
  return str.replace(/\/$/, "");
}
