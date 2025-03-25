import path from "path";
import { ORD_SERVER_PREFIX_PATH } from "../constant.js";

export function getOrdDocumentPath(rootPath: string, file: string): string {
  return `${ORD_SERVER_PREFIX_PATH}/${getEncodedFilePath(rootPath, file)}`;
}

export function getEncodedFilePath(rootPath: string, file: string): string {
  const relativeFilePath = path.posix.relative(rootPath, file);
  const { dir, name } = path.posix.parse(relativeFilePath);
  const encodedFileName = encodeURIComponent(name);
  return path.posix.join(dir, encodedFileName);
}
