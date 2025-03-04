import { ORDDocument } from "@sap/open-resource-discovery";
import path from "path";
import { ORD_DOCUMENTS_URL_PATH, ORD_GITHUB_DEFAULT_ROOT_DIRECTORY, ORD_SERVER_PREFIX_PATH } from "src/constant.js";
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
import { FqnDocumentMap } from "../util/fqnHelpers.js";
import { log } from "../util/logger.js";
import { validateOrdDocument } from "../util/validateOrdDocument.js";

interface GithubRouterOptions extends Omit<RouterOptions, "sourceType" | "githubOpts">, GithubOpts {
  fqnDocumentMap: FqnDocumentMap;
}

export class GithubRouter extends BaseRouter {
  private readonly githubApiUrl: string;
  private readonly githubRepository: string;
  private readonly githubBranch: string;
  private readonly githubToken?: string;
  private readonly customDirectory?: string;
  private readonly fqnDocumentMap: FqnDocumentMap;

  public constructor(options: GithubRouterOptions) {
    super(options);
    this.githubApiUrl = options.githubApiUrl;
    this.githubRepository = options.githubRepository;
    this.githubBranch = options.githubBranch;
    this.githubToken = options.githubToken;
    this.customDirectory = options.customDirectory;
    this.fqnDocumentMap = options.fqnDocumentMap;
  }

  public register(server: FastifyInstanceType): void {
    // Configuration endpoint
    this.configurationEndpoint(server);

    // Document endpoint
    server.get(`${ORD_DOCUMENTS_URL_PATH}/:documentName`, async (request) => {
      const { documentName } = request.params as { documentName: string };

      const pathSegments = path.posix.normalize(this.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);

      let response: GitHubFileResponse;

      try {
        response = await fetchGitHubFile<GitHubFileResponse>(
          {
            host: this.githubApiUrl,
            repo: this.githubRepository,
            branch: this.githubBranch,
          },
          `${pathSegments}/documents/${documentName}.json`,
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
      const cachedDoc = OrdDocumentProcessor.getFromCache(cacheKey);
      if (cachedDoc) return cachedDoc;

      try {
        validateOrdDocument(jsonData as ORDDocument);
      } catch {
        throw new NotFoundError(`Could not find a valid ORD document: ${documentName}`);
      }

      return OrdDocumentProcessor.processGithubDocument(
        {
          baseUrl: this.baseUrl,
          authMethods: this.authMethods,
          githubBranch: this.githubBranch,
          githubApiUrl: this.githubApiUrl,
          githubRepo: this.githubRepository,
          githubToken: this.githubToken || "",
        },
        cacheKey,
        jsonData,
      );
    });

    // Resource files endpoint
    server.get(`${ORD_SERVER_PREFIX_PATH}/:ordId/:documentName`, async (request) => {
      const { ordId, documentName } = request.params as {
        ordId: string;
        documentName: string;
      };

      const resourceMap = this.fqnDocumentMap[ordId]?.find((resource) => resource.fileName === documentName);
      const pathSegments = path.posix.normalize(this.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);
      const githubPath = resourceMap
        ? `${pathSegments}/${resourceMap.filePath}`
        : `${pathSegments}/${ordId}/${documentName}`;

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
        const jsonData = JSON.parse(Buffer.from(response.content, "base64").toString("utf-8"));
        const cacheKey = `${documentName}:${response.sha}`;

        return OrdDocumentProcessor.processGithubDocument(
          {
            baseUrl: this.baseUrl,
            authMethods: this.authMethods,
            githubBranch: this.githubBranch,
            githubApiUrl: this.githubApiUrl,
            githubRepo: this.githubRepository,
            githubToken: this.githubToken || "",
          },
          cacheKey,
          jsonData,
        );
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
