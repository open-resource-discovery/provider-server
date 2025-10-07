import { ORDDocument } from "@open-resource-discovery/specification";
import { DocumentRepository } from "./interfaces/documentRepository.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getAllFiles } from "../util/files.js";
import { log } from "../util/logger.js";
import { validateOrdDocument } from "../util/validateOrdDocument.js";
import { joinFilePaths, normalizePath } from "../util/pathUtils.js";

export class LocalDocumentRepository implements DocumentRepository {
  private readonly ordDirectory: string;
  private directoryExists: boolean = false;

  public constructor(ordDirectory: string) {
    this.ordDirectory = normalizePath(ordDirectory);
    this.checkDirectoryExists();
  }

  private checkDirectoryExists(): void {
    try {
      const stats = fs.statSync(this.ordDirectory);
      this.directoryExists = stats.isDirectory();
    } catch {
      this.directoryExists = false;
    }
  }

  private getFullLocalPath(relativePath: string): string {
    return joinFilePaths(this.ordDirectory, relativePath);
  }

  public getDocument(path: string): Promise<ORDDocument | null> {
    const fullPath = this.getFullLocalPath(path);
    try {
      if (fs.existsSync(fullPath) && fullPath.endsWith(".json")) {
        const content = fs.readFileSync(fullPath).toString("utf-8");
        const jsonData = JSON.parse(content);

        if (jsonData && jsonData.openResourceDiscovery) {
          validateOrdDocument(jsonData as ORDDocument);
          return Promise.resolve(jsonData as ORDDocument);
        }
        log.warn(`File at ${fullPath} is not a valid ORD document.`);
      }
      return Promise.resolve(null);
    } catch (error) {
      log.error(`Error reading local document ${fullPath}: ${error}`);
      return Promise.resolve(null);
    }
  }

  public getDocuments(directoryPath: string): Promise<Map<string, ORDDocument>> {
    return (async (): Promise<Map<string, ORDDocument>> => {
      const documents = new Map<string, ORDDocument>();
      try {
        const files = await this.listFiles(directoryPath);

        for (const file of files) {
          if (file.endsWith(".json")) {
            const doc = await this.getDocument(file);
            if (doc) {
              const relativePath = path
                .relative(this.ordDirectory, this.getFullLocalPath(file))
                .split(path.sep)
                .join(path.posix.sep);
              documents.set(relativePath, doc);
            }
          }
        }
      } catch (error) {
        log.error(`Error fetching documents from local directory relative path ${directoryPath}: ${error}`);
      }
      return documents;
    })();
  }

  public async getDirectoryHash(directoryPath: string): Promise<string | null> {
    if (!this.directoryExists) {
      return Promise.resolve("no-content");
    }
    const fullDirectoryPath = this.getFullLocalPath(directoryPath);
    try {
      // Check if directory exists first
      if (!fs.existsSync(fullDirectoryPath)) {
        log.debug(`Directory ${fullDirectoryPath} does not exist yet`);
        return Promise.resolve(null);
      }

      // Simple hash based on file modification times for local directories
      const files = await getAllFiles(fullDirectoryPath);

      const hash = crypto.createHash("sha256");
      for (const file of files.sort()) {
        const stats = fs.statSync(file);
        hash.update(file + stats.mtimeMs);
      }

      return Promise.resolve(hash.digest("hex"));
    } catch (error) {
      log.error(`Error calculating hash for local directory ${fullDirectoryPath}: ${error}`);
      return Promise.resolve(null);
    }
  }

  public async listFiles(directoryPath: string, _recursive?: boolean): Promise<string[]> {
    if (!this.directoryExists) {
      return Promise.resolve([]);
    }
    const fullDirectoryPath = this.getFullLocalPath(directoryPath);
    try {
      const files = await getAllFiles(fullDirectoryPath);
      return Promise.resolve(
        files.map((file) => path.relative(this.ordDirectory, file).split(path.sep).join(path.posix.sep)),
      );
    } catch (error) {
      log.error(`Error listing files in local directory ${fullDirectoryPath}: ${error}`);
      return Promise.resolve([]);
    }
  }

  public getFileContent(path: string): Promise<string | Buffer | null> {
    const fullPath = this.getFullLocalPath(path);
    try {
      if (fs.existsSync(fullPath)) {
        return Promise.resolve(fs.readFileSync(fullPath));
      }
      return Promise.resolve(null);
    } catch (error) {
      log.error(`Error reading local file content ${fullPath}: ${error}`);
      return Promise.resolve(null);
    }
  }
}
