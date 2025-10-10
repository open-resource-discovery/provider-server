import { GithubOpts } from "../model/github.js";
import { OptAuthMethod, OptSourceType } from "../model/cli.js";
import { DocumentRepository } from "../repositories/interfaces/documentRepository.js";
import { LocalDocumentRepository } from "../repositories/localDocumentRepository.js";
import { CacheService } from "../services/cacheService.js";
import { DocumentService } from "../services/documentService.js";
import { DocumentRouter } from "../routes/documentRouter.js";
import { FqnDocumentMap } from "../util/fqnHelpers.js";
import { ProcessingContext } from "../services/interfaces/processingContext.js";
import { PATH_CONSTANTS } from "../constant.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { log } from "../util/logger.js";

interface FactoryOptions {
  sourceType: OptSourceType;
  baseUrl: string;
  authMethods: OptAuthMethod[];
  fqnDocumentMap: FqnDocumentMap;
  documentsSubDirectory?: string;
  githubOpts?: GithubOpts;
  ordDirectory?: string;
  fileSystemManager?: FileSystemManager;
}

export class RouterFactory {
  public static async createRouter(options: FactoryOptions): Promise<{
    router: DocumentRouter;
    cacheService: CacheService;
  }> {
    let repository: DocumentRepository;
    let processingContext: ProcessingContext;
    const documentsSubDirectory = options.documentsSubDirectory || PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY;

    if (options.sourceType === OptSourceType.Github && options.githubOpts) {
      // For GitHub source, use LocalDocumentRepository with the cloned content
      if (!options.fileSystemManager) {
        throw new Error("FileSystemManager is required for GitHub source type");
      }
      const currentPath = options.fileSystemManager.getCurrentPath();
      repository = new LocalDocumentRepository(currentPath);
      processingContext = {
        baseUrl: options.baseUrl,
        authMethods: options.authMethods,
        githubBranch: options.githubOpts.githubBranch,
        githubApiUrl: options.githubOpts.githubApiUrl,
        githubRepo: options.githubOpts.githubRepository,
        githubToken: options.githubOpts.githubToken,
      };
    } else if (options.sourceType === OptSourceType.Local && options.ordDirectory) {
      repository = new LocalDocumentRepository(options.ordDirectory);
      processingContext = {
        baseUrl: options.baseUrl,
        authMethods: options.authMethods,
      };
    } else {
      throw new Error("Invalid configuration: Missing required options for the specified source type.");
    }

    const cacheService = new CacheService(processingContext, log);

    const documentService = new DocumentService(repository, cacheService, processingContext, documentsSubDirectory);

    // For GitHub source, always defer document loading to avoid blocking server startup
    let fqnDocumentMap = {};

    if (options.sourceType === OptSourceType.Github) {
      // Check branch mismatch for logging purposes only
      if (options.fileSystemManager) {
        const metadata = await options.fileSystemManager.getMetadata();

        if (metadata && options.githubOpts) {
          const branchMatches = metadata.branch === options.githubOpts.githubBranch;
          const repoMatches = metadata.repository === options.githubOpts.githubRepository;

          if (!branchMatches || !repoMatches) {
            log.info(`Branch/repo will be updated in background:`);
            log.info(`  Current: ${metadata.branch} (${metadata.repository})`);
            log.info(`  Requested: ${options.githubOpts.githubBranch} (${options.githubOpts.githubRepository})`);
          } else {
            log.info(`Using existing content from ${metadata.branch} branch`);
          }
        }
      }
    }

    if (options.sourceType === OptSourceType.Local) {
      // For local source, load immediately (synchronous behavior)
      fqnDocumentMap = await documentService.getFqnMap();
    }
    // For GitHub source, fqnDocumentMap stays as (empty)
    // It will be loaded lazily on first request via ensureDataLoaded()

    const routerOptions = {
      baseUrl: options.baseUrl,
      authMethods: options.authMethods,
      fqnDocumentMap: fqnDocumentMap,
      documentsSubDirectory: documentsSubDirectory,
    };

    const router = new DocumentRouter(documentService, {
      ...routerOptions,
    });

    return {
      router,
      cacheService,
    };
  }
}
