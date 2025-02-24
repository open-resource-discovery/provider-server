import { APIResource, EventResource, ORDConfiguration, ORDDocument } from "@sap/open-resource-discovery";
import fs from "fs";
import path from "path";
import {
  ORD_DOCUMENTS_SUB_DIRECTORY,
  ORD_GITHUB_DEFAULT_ROOT_DIRECTORY,
  ORD_SERVER_PREFIX_PATH,
} from "src/constant.js";
import { OptAuthMethod } from "src/model/cli.js";
import { getAllFiles } from "src/util/files.js";
import { log } from "src/util/logger.js";
import { getOrdDocumentAccessStrategies } from "src/util/ordConfig.js";
import { GitHubFileResponse, GithubOpts } from "../model/github.js";
import { FqnDocumentMap, getFlattenedOrdFqnDocumentMap } from "../util/fqnHelpers.js";
import { fetchGitHubFile, listGitHubDirectory } from "../util/github.js";

interface DocumentCache {
  [key: string]: ORDDocument;
}

export interface ProcessingContext {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepo?: string;
  githubToken?: string;
}

export class OrdDocumentProcessor {
  private static documentCache: DocumentCache = {};

  // processResourceDefinition will parse URLs of resource definitions and apply given access strategy
  private static processResourceDefinition<T extends EventResource | APIResource>(
    authMethods: OptAuthMethod[],
    resources: T[],
  ): T[] {
    return resources.map((resource) => ({
      ...resource,
      resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => {
        return {
          ...definition,
          ...(definition.url && { url: this.fixUrl(definition.url, resource.ordId) }),
          accessStrategies: getOrdDocumentAccessStrategies(authMethods),
        };
      }),
    }));
  }

  private static fixUrl(url: string, ordId: string): string {
    const escapedOrdId = ordId.replace(/:/gi, "_");
    const pathParts = url.split("/");
    const ordIdIdx = pathParts.findIndex((part) => escapedOrdId === part);

    if (ordIdIdx > -1) {
      // If the path segment is an escaped ORD ID for filesystem compatiblity issues
      // replace it with the real ORD ID
      pathParts[ordIdIdx] = ordId;
    }

    const urlWithFixedOrdId = pathParts.join("/");

    if (this.isRemoteUrl(url)) {
      return urlWithFixedOrdId;
    }
    return path.posix.join(ORD_SERVER_PREFIX_PATH, path.posix.resolve("/", urlWithFixedOrdId));
  }

  private static isRemoteUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
  }

  public static getFromCache(cacheKey: string): ORDDocument | undefined {
    if (this.documentCache[cacheKey]) {
      return this.documentCache[cacheKey];
    }
  }

  public static async preprocessGithubDocuments(
    githubOpts: GithubOpts,
    baseUrl: string,
    authenticationMethods: OptAuthMethod[],
  ): Promise<{ documents: ORDDocument[]; fqnDocumentMap: FqnDocumentMap }> {
    const githubInstance = {
      host: githubOpts.githubApiUrl,
      repo: githubOpts.githubRepository,
      branch: githubOpts.githubBranch,
    };

    const pathSegments = path.normalize(githubOpts.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);
    const files = await listGitHubDirectory(
      githubInstance,
      `${pathSegments}/${ORD_DOCUMENTS_SUB_DIRECTORY}`,
      githubOpts.githubToken,
    );

    const documents = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (fileName) => {
          const file = await fetchGitHubFile<GitHubFileResponse>(
            githubInstance,
            `${pathSegments}/documents/${fileName}`,
            githubOpts.githubToken,
          );

          const ordDocument = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8")) as ORDDocument;
          return { ordDocument, fileName, sha: file.sha };
        }),
    );

    const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(
      documents.map(({ ordDocument, fileName, sha }) =>
        OrdDocumentProcessor.processGithubDocument(
          {
            baseUrl,
            authMethods: authenticationMethods,
            githubBranch: githubOpts.githubBranch,
            githubApiUrl: githubOpts.githubApiUrl,
            githubRepo: githubOpts.githubRepository,
            githubToken: githubOpts.githubToken,
          },
          `${fileName}:${sha}`,
          ordDocument,
        ),
      ),
    );

    return { documents: documents.map(({ ordDocument }) => ordDocument), fqnDocumentMap };
  }

  private static updateResources(context: ProcessingContext, document: ORDDocument): ORDDocument {
    const eventResources = this.processResourceDefinition(context.authMethods, document.eventResources || []);
    const apiResources = this.processResourceDefinition(context.authMethods, document.apiResources || []);

    return {
      ...document,
      describedSystemInstance: {
        ...document.describedSystemInstance,
        baseUrl: context.baseUrl,
      },
      apiResources: apiResources.length ? apiResources : undefined,
      eventResources: eventResources.length ? eventResources : undefined,
    };
  }

  public static processGithubDocument(
    context: ProcessingContext,
    cacheKey: string,
    document: ORDDocument,
  ): ORDDocument {
    const cachedDoc = this.getFromCache(cacheKey);
    if (cachedDoc) {
      return cachedDoc;
    }

    const processedDocument = this.updateResources(context, document);
    this.documentCache[cacheKey] = processedDocument;
    return processedDocument;
  }

  public static processLocalDocuments(
    context: ProcessingContext,
    ordConfig: ORDConfiguration,
    ordDirectory: string,
  ): { [relativeFilePath: string]: ORDDocument } {
    const ordDocuments: { [relativeFilePath: string]: ORDDocument } = {};
    const ordDocumentDirectoryPath = `${ordDirectory.replace(/\/$/, "")}/${ORD_DOCUMENTS_SUB_DIRECTORY}`;
    const ordFiles = getAllFiles(ordDocumentDirectoryPath);

    if (ordFiles.length === 0) {
      throw new Error(`No ORD documents found in ${ordDocumentDirectoryPath}.`);
    }

    for (const file of ordFiles) {
      if (!file.endsWith(".json")) {
        log.warn(`Only .json file extensions are supported. Skipping ${file}`);
        continue;
      }
      const relativeFilePath = path.posix.relative(ordDirectory, file);
      const filePathParsed = path.posix.parse(relativeFilePath);
      const encodedFileName = encodeURIComponent(filePathParsed.name);
      const relativeUrl = `${ORD_SERVER_PREFIX_PATH}/${ORD_DOCUMENTS_SUB_DIRECTORY}/${encodedFileName}`;

      try {
        const ordDocumentText = fs.readFileSync(file).toString();
        const ordDocumentParsed = JSON.parse(ordDocumentText) as ORDDocument;

        if (!ordDocumentParsed.openResourceDiscovery) {
          log.warn(`Invalid ORD document found in ${file}`);
          continue;
        }

        log.info(`>> Served: ${context.baseUrl}${relativeUrl}`);

        ordConfig.openResourceDiscoveryV1.documents?.push({
          url: relativeUrl,
          accessStrategies: getOrdDocumentAccessStrategies(context.authMethods),
        });

        const processedDocument = this.updateResources(context, ordDocumentParsed);
        ordDocuments[encodedFileName] = processedDocument;
      } catch (error) {
        log.error(`Error processing file ${file}: ${error}`);
      }
    }

    if (Object.keys(ordDocuments).length === 0) {
      throw new Error(`No valid ORD documents found in ${ordDocumentDirectoryPath}.`);
    }

    return ordDocuments;
  }
}
