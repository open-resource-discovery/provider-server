import { ORDDocument } from "@open-resource-discovery/specification";
import { PATH_CONSTANTS } from "src/constant.js";
import { joinFilePaths, normalizePath, getFileName } from "src/util/pathUtils.js";
import { FastifyInstanceType } from "src/model/fastify.js";
import { GitHubFileResponse, GithubOpts } from "src/model/github.js";
import { BaseRouter, RouterOptions } from "src/routes/baseRouter.js";
import { fetchGitHubFile } from "src/util/github.js";
import {
  GitHubAccessError,
  GitHubDirectoryNotFoundError,
  GitHubFileNotFoundError,
  GitHubNetworkError,
} from "../model/error/GithubErrors.js";
import { NotFoundError } from "../model/error/NotFoundError.js";
import { OrdDocumentProcessor } from "../services/ordProcessorService.js";
import { FqnDocumentMap, isOrdId } from "../util/fqnHelpers.js";
import { log } from "../util/logger.js";
import { validateOrdDocument } from "../util/validateOrdDocument.js";

interface GithubRouterOptions extends Omit<RouterOptions, "sourceType" | "githubOpts">, GithubOpts {
  fqnDocumentMap: FqnDocumentMap;
  documentsSubDirectory?: string;
}

export class GithubRouter extends BaseRouter {
  private readonly githubApiUrl: string;
  private readonly githubRepository: string;
  private readonly githubBranch: string;
  private readonly githubToken?: string;
  private readonly customDirectory?: string;
  private readonly fqnDocumentMap: FqnDocumentMap;
  private readonly documentsSubDirectory: string;

  public constructor(options: GithubRouterOptions) {
    super(options);
    this.githubApiUrl = options.githubApiUrl;
    this.githubRepository = options.githubRepository;
    this.githubBranch = options.githubBranch;
    this.githubToken = options.githubToken;
    this.customDirectory = options.customDirectory;
    this.fqnDocumentMap = options.fqnDocumentMap;
    this.documentsSubDirectory = options.documentsSubDirectory || "documents";
  }

  public register(server: FastifyInstanceType): void {
    // Configuration endpoint
    this.configurationEndpoint(server);

    // Document endpoint
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/${this.documentsSubDirectory}/*`, async (request) => {
      const { "*": documentPath } = request.params as { "*": string };

      // Extract the document name from the path (last segment without extension)
      const pathSegments = documentPath.split("/");
      const documentName = getFileName(pathSegments[pathSegments.length - 1]);
      const documentPathWithExtension = documentPath.endsWith(".json") ? documentPath : `${documentPath}.json`;
      const rootPath = normalizePath(this.customDirectory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);
      const githubPath = joinFilePaths(rootPath, this.documentsSubDirectory, documentPathWithExtension);

      let response: GitHubFileResponse;

      try {
        response = await fetchGitHubFile<GitHubFileResponse>(
          {
            host: this.githubApiUrl,
            repo: this.githubRepository,
            branch: this.githubBranch,
          },
          githubPath,
          this.githubToken,
        );
      } catch (error: unknown) {
        logError(error);
        throw error;
      }

      const ordDocument = Buffer.from(response.content, "base64").toString("utf-8");
      const jsonData = JSON.parse(ordDocument);
      const cacheKey = `${documentName}:${response.sha}`;

      // Try to pull doc from cache before validation
      const cachedDoc = OrdDocumentProcessor.getProcessedDocumentFromCache(cacheKey);
      if (cachedDoc) return cachedDoc;

      try {
        validateOrdDocument(jsonData as ORDDocument);
      } catch {
        throw new NotFoundError(`Could not find a valid ORD document: ${documentPath}`);
      }

      return OrdDocumentProcessor.processGithubDocument(
        {
          baseUrl: this.baseUrl,
          authMethods: this.authMethods,
          documentsSubDirectory: this.documentsSubDirectory,
          githubBranch: this.githubBranch,
          githubApiUrl: this.githubApiUrl,
          githubRepo: this.githubRepository,
          githubToken: this.githubToken || "",
        },
        cacheKey,
        jsonData,
      );
    });

    // Root-level files endpoint
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:fileName`, async (request, reply) => {
      const { fileName } = request.params as { fileName: string };

      // Skip if this is a documents route or another known route
      if (fileName === this.documentsSubDirectory) {
        return reply.callNotFound();
      }

      const rootPath = normalizePath(this.customDirectory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);
      const githubPath = joinFilePaths(rootPath, fileName);

      let response: GitHubFileResponse;
      try {
        response = await fetchGitHubFile<GitHubFileResponse>(
          {
            host: this.githubApiUrl,
            repo: this.githubRepository,
            branch: this.githubBranch,
          },
          githubPath,
          this.githubToken,
        );

        // Return the file content directly
        return JSON.parse(Buffer.from(response.content, "base64").toString("utf-8"));
      } catch (error: unknown) {
        logError(error);
        throw error;
      }
    });

    // Resource files endpoint with wildcard support
    server.get(`${PATH_CONSTANTS.SERVER_PREFIX}/:ordId/*`, async (request, reply) => {
      let { ordId } = request.params as { ordId: string };
      let { "*": unknownPath } = request.params as { "*": string };

      // Skip if this is a documents route
      if (ordId === this.documentsSubDirectory) {
        return reply.callNotFound();
      }

      // We assume that the :ordId is correct given and the next part * is the file name.
      // In case it's a false assumption, we try to parse the ordId and the file name.
      let fileName = unknownPath;

      if (!isOrdId(ordId)) {
        const foundOrdId = unknownPath.split("/").find(isOrdId);
        if (foundOrdId) {
          ordId = foundOrdId;
        }

        fileName = unknownPath.split("/").pop()!;
      }

      // First try to find the resource in the FQN document map
      const resourceMap = this.fqnDocumentMap[ordId]?.find(
        (resource) => resource.fileName === fileName || `/${resource.fileName}` === fileName,
      );

      const rootPath = normalizePath(this.customDirectory || PATH_CONSTANTS.GITHUB_DEFAULT_ROOT);

      let githubPath: string;

      // If found in the map, use the mapped path
      if (resourceMap) {
        githubPath = joinFilePaths(rootPath, resourceMap.filePath);
      } else {
        // If not found in the map, try to fetch it directly
        if (!unknownPath.endsWith(".json")) {
          unknownPath += ".json";
        }
        githubPath = joinFilePaths(rootPath, ordId, unknownPath);
      }

      try {
        const response = await fetchGitHubFile<GitHubFileResponse>(
          {
            host: this.githubApiUrl,
            repo: this.githubRepository,
            branch: this.githubBranch,
          },
          githubPath,
          this.githubToken,
        );

        // Get the content
        const content = Buffer.from(response.content, "base64").toString("utf-8");

        try {
          const jsonData = JSON.parse(content);

          // If it's an ORD document, process it
          if (jsonData.openResourceDiscovery) {
            const documentName = getFileName(unknownPath);
            const cacheKey = `${documentName}:${response.sha}`;

            return OrdDocumentProcessor.processGithubDocument(
              {
                baseUrl: this.baseUrl,
                authMethods: this.authMethods,
                documentsSubDirectory: this.documentsSubDirectory,
                githubBranch: this.githubBranch,
                githubApiUrl: this.githubApiUrl,
                githubRepo: this.githubRepository,
                githubToken: this.githubToken || "",
              },
              cacheKey,
              jsonData,
            );
          }

          // Otherwise, return the JSON data directly
          return jsonData;
        } catch (_parseError) {
          return content;
        }
      } catch (error: unknown) {
        logError(error);
        throw error;
      }
    });
  }
}

function logError(error: unknown): void {
  if (error instanceof GitHubDirectoryNotFoundError) {
    log.error("The documents directory was not found");
  } else if (error instanceof GitHubAccessError) {
    log.error("Failed to access GitHub:", error.message);
  } else if (error instanceof GitHubNetworkError) {
    log.error("Network error:", error.message);
  } else if (error instanceof GitHubFileNotFoundError) {
    log.error("Github file not found:", error.message);
  } else {
    log.error("An unexpected error occurred:", error);
  }
}
