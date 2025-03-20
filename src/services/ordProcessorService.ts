import { APIResource, EventResource, ORDConfiguration, ORDDocument } from "@open-resource-discovery/specification";
import crypto from "crypto";
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
import { fetchGitHubFile, getGithubDirectoryContents } from "../util/github.js";
import { getEncodedFilePath, getOrdDocumentPath } from "../util/documentUrl.js";

interface DocumentCache {
  [key: string]: ORDDocument;
}

interface OrdConfigurationCache {
  [key: string]: ORDConfiguration;
}

export interface ProcessingContext {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  documentsSubDirectory?: string;
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepo?: string;
  githubToken?: string;
}

export type LocalProcessResult = { [relativeFilePath: string]: ORDDocument };

export class OrdDocumentProcessor {
  private static documentCache: DocumentCache = {};
  private static ordConfigCache: OrdConfigurationCache = {};

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

  public static getProcessedDocumentFromCache(cacheKey: string): ORDDocument | undefined {
    if (this.documentCache[cacheKey]) {
      return this.documentCache[cacheKey];
    }
  }

  public static setCachedOrdConfig(cacheKey: string, ordConfig: ORDConfiguration): void {
    this.ordConfigCache[cacheKey] = ordConfig;
  }

  public static getCachedOrdConfig(cacheKey: string): ORDConfiguration | undefined {
    return this.ordConfigCache[cacheKey];
  }

  public static async preprocessGithubDocuments(
    githubOpts: GithubOpts,
    baseUrl: string,
    authenticationMethods: OptAuthMethod[],
    documentsSubDirectory: string = ORD_DOCUMENTS_SUB_DIRECTORY,
  ): Promise<{ documents: ORDDocument[]; fqnDocumentMap: FqnDocumentMap }> {
    const githubInstance = {
      host: githubOpts.githubApiUrl,
      repo: githubOpts.githubRepository,
      branch: githubOpts.githubBranch,
    };

    const pathSegments = path.normalize(githubOpts.customDirectory || ORD_GITHUB_DEFAULT_ROOT_DIRECTORY);

    const files = (
      await getGithubDirectoryContents(
        githubInstance,
        path.posix.join(pathSegments, documentsSubDirectory),
        githubOpts.githubToken,
        true,
      )
    )
      .filter((item) => item.type === "file")
      .map((item) => item.path);

    const documents = await Promise.all(
      files
        .filter((filePath) => filePath.endsWith(".json"))
        .map(async (filePath) => {
          const file = await fetchGitHubFile<GitHubFileResponse>(githubInstance, filePath, githubOpts.githubToken);

          const ordDocument = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8")) as ORDDocument;
          return { ordDocument, filePath, sha: file.sha };
        }),
    );

    const fqnDocumentMap = getFlattenedOrdFqnDocumentMap(
      documents.map(({ ordDocument, filePath, sha }) =>
        OrdDocumentProcessor.processGithubDocument(
          {
            baseUrl,
            authMethods: authenticationMethods,
            githubBranch: githubOpts.githubBranch,
            githubApiUrl: githubOpts.githubApiUrl,
            githubRepo: githubOpts.githubRepository,
            githubToken: githubOpts.githubToken,
          },
          `${filePath}:${sha}`,
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
    const cachedDoc = this.getProcessedDocumentFromCache(cacheKey);
    if (cachedDoc) {
      return cachedDoc;
    }

    const processedDocument = this.updateResources(context, document);
    this.documentCache[cacheKey] = processedDocument;
    return processedDocument;
  }

  public static registerLocalUpdateHandler(
    context: ProcessingContext,
    ordConfig: ORDConfiguration,
    ordDirectory: string,
    callback: (updatedResult: LocalProcessResult) => void,
  ): void {
    const documentsSubDirectory = context.documentsSubDirectory || ORD_DOCUMENTS_SUB_DIRECTORY;
    const ordDocumentDirectoryPath = `${ordDirectory.replace(/\/$/, "")}/${documentsSubDirectory}`;
    fs.watch(ordDocumentDirectoryPath, (event, fileName) => {
      if (event === "rename" && fileName) {
        Object.keys(this.documentCache)
          .filter((key) => key.startsWith(`${encodeURIComponent(fileName)}:`))
          .forEach((key) => delete this.documentCache[key]);
      }
      try {
        const updatedResult = OrdDocumentProcessor.processLocalDocuments(context, ordConfig, ordDirectory);
        callback(updatedResult);
      } catch (err) {
        log.error(err);
        callback({});
      }
    });
  }

  public static processLocalDocuments(
    context: ProcessingContext,
    ordConfig: ORDConfiguration,
    ordDirectory: string,
  ): LocalProcessResult {
    const ordDocuments: LocalProcessResult = {};
    const documentsSubDirectory = context.documentsSubDirectory || ORD_DOCUMENTS_SUB_DIRECTORY;
    const ordDocumentDirectoryPath = `${ordDirectory.replace(/\/$/, "")}/${documentsSubDirectory}`;
    const ordFiles = getAllFiles(ordDocumentDirectoryPath);

    ordConfig.openResourceDiscoveryV1.documents = [];

    if (ordFiles.length === 0) {
      throw new Error(`No ORD documents found in ${ordDocumentDirectoryPath}.`);
    }

    for (const file of ordFiles) {
      if (!file.endsWith(".json")) {
        log.warn(`Only .json file extensions are supported. Skipping ${file}`);
        continue;
      }

      const relativeUrl = getOrdDocumentPath(ordDirectory, file);

      try {
        const encodedFilePath = getEncodedFilePath(ordDirectory, file);
        const ordDocumentText = fs.readFileSync(file).toString();
        const shaChecksum = crypto.createHash("sha256").update(ordDocumentText).digest("hex");
        const cacheKey = `${encodedFilePath}:${shaChecksum}`;
        if (this.documentCache[cacheKey]) {
          ordDocuments[encodedFilePath] = this.documentCache[cacheKey];
          ordConfig.openResourceDiscoveryV1.documents?.push({
            url: relativeUrl,
            accessStrategies: getOrdDocumentAccessStrategies(context.authMethods),
          });
          continue;
        }
        const ordDocumentParsed = JSON.parse(ordDocumentText) as ORDDocument;

        if (!ordDocumentParsed.openResourceDiscovery) {
          log.warn(`Invalid ORD document found in ${file}`);
          continue;
        }

        log.info(`Served: ${context.baseUrl}${relativeUrl}`);

        ordConfig.openResourceDiscoveryV1.documents?.push({
          url: relativeUrl,
          accessStrategies: getOrdDocumentAccessStrategies(context.authMethods),
        });

        const processedDocument = this.updateResources(context, ordDocumentParsed);
        ordDocuments[encodedFilePath] = processedDocument;
        this.documentCache[cacheKey] = processedDocument;
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
