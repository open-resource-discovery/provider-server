import { ORDDocument } from "@open-resource-discovery/specification";
import { DocumentRepository } from "./interfaces/documentRepository.js";
import { GithubOpts, GitHubFileResponse, GitHubInstance } from "../model/github.js";
import { fetchGitHubFile, getDirectoryHash, getGithubDirectoryContents } from "../util/github.js";
import { normalizePath, joinFilePaths } from "../util/pathUtils.js";
import { PATH_CONSTANTS } from "../constant.js";
import { log } from "../util/logger.js";
import { validateOrdDocument } from "../util/validateOrdDocument.js";

export class GithubDocumentRepository implements DocumentRepository {
  private readonly githubInstance: GitHubInstance;
  private readonly githubToken?: string;
  private readonly rootPath: string;

  public constructor(githubOpts: GithubOpts) {
    this.githubInstance = {
      host: githubOpts.githubApiUrl,
      repo: githubOpts.githubRepository,
      branch: githubOpts.githubBranch,
    };
    this.githubToken = githubOpts.githubToken;
    this.rootPath = normalizePath(githubOpts.customDirectory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);
  }

  private getFullGithubPath(relativePath: string): string {
    // Ensure rootPath doesn't have trailing slash for clean joins
    const cleanedRootPath = this.rootPath.replace(/\/$/, "");
    // Ensure relativePath doesn't have leading slash
    const cleanedRelativePath = relativePath.replace(/^\//, "");
    return joinFilePaths(cleanedRootPath, cleanedRelativePath);
  }

  // Expects path relative to rootPath
  public async getDocument(relativePath: string): Promise<ORDDocument | null> {
    const githubPath = this.getFullGithubPath(relativePath);
    try {
      const response = await fetchGitHubFile<GitHubFileResponse>(this.githubInstance, githubPath, this.githubToken);
      const content = Buffer.from(response.content, "base64").toString("utf-8");
      const jsonData = JSON.parse(content);

      // Basic validation to ensure it's an ORD document
      if (jsonData && jsonData.openResourceDiscovery) {
        validateOrdDocument(jsonData as ORDDocument);
        return jsonData as ORDDocument;
      }
      log.warn(`File at ${githubPath} is not a valid ORD document.`);
      return null;
    } catch (error) {
      log.error(`Error fetching document from GitHub path ${githubPath}: ${error}`);
      return null;
    }
  }

  // Expects directoryPath relative to rootPath
  public async getDocuments(directoryPath: string): Promise<Map<string, ORDDocument>> {
    const documents = new Map<string, ORDDocument>();
    try {
      // listFiles now returns paths relative to rootPath
      const relativeFilePaths = await this.listFiles(directoryPath, true);

      for (const relativeFilePath of relativeFilePaths) {
        // Check if the file is within the requested directoryPath (relative to rootPath)
        if (relativeFilePath.startsWith(directoryPath) && relativeFilePath.endsWith(".json")) {
          const doc = await this.getDocument(relativeFilePath); // Pass relative path
          if (doc) {
            documents.set(relativeFilePath, doc);
          }
        }
      }
    } catch (error) {
      // Log with the relative directory path expected by the method
      log.error(`Error fetching documents from GitHub directory relative path ${directoryPath}: ${error}`);
    }
    return documents;
  }

  // Expects directoryPath relative to rootPath
  public async getDirectoryHash(relativePath: string): Promise<string | null> {
    const fullDirectoryPath = this.getFullGithubPath(relativePath);
    try {
      const hash = await getDirectoryHash(this.githubInstance, fullDirectoryPath, this.githubToken);
      return hash || null;
    } catch (error) {
      log.error(`Error fetching directory hash from GitHub path ${fullDirectoryPath}: ${error}`);
      return null;
    }
  }

  // Expects directoryPath relative to rootPath
  public async listFiles(directoryPath: string, recursive: boolean = true): Promise<string[]> {
    const fullDirectoryPath = this.getFullGithubPath(directoryPath);
    try {
      const contents = await getGithubDirectoryContents(
        this.githubInstance,
        fullDirectoryPath,
        this.githubToken,
        recursive,
      );
      const cleanedRootPath = this.rootPath.replace(/\/$/, "");
      const rootPathPrefix = cleanedRootPath === "/" ? "" : cleanedRootPath + "/";

      return contents
        .filter((item) => item.type === "file")
        .map((item) => {
          // item.path is absolute from repo root, make it relative to rootPath
          if (item.path.startsWith(rootPathPrefix)) {
            return item.path.substring(rootPathPrefix.length);
          }
          // Handle cases where rootPath is '/' or path doesn't match prefix (shouldn't happen ideally)
          return item.path.startsWith("/") ? item.path.substring(1) : item.path;
        });
    } catch (error) {
      log.error(`Error listing files in GitHub directory ${fullDirectoryPath}: ${error}`);
      return [];
    }
  }

  // Expects path relative to rootPath
  public async getFileContent(relativePath: string): Promise<string | Buffer | null> {
    const githubPath = this.getFullGithubPath(relativePath);
    try {
      const response = await fetchGitHubFile<GitHubFileResponse>(this.githubInstance, githubPath, this.githubToken);
      return Buffer.from(response.content, "base64").toString("utf-8");
    } catch (error) {
      log.error(`Error fetching file content from GitHub path ${githubPath}: ${error}`);
      return null;
    }
  }
}
