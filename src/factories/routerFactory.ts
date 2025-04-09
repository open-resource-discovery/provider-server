import { GithubOpts } from "../model/github.js";
import { OptAuthMethod, OptSourceType } from "../model/cli.js";
import { DocumentRepository } from "../repositories/interfaces/documentRepository.js";
import { GithubDocumentRepository } from "../repositories/githubDocumentRepository.js";
import { LocalDocumentRepository } from "../repositories/localDocumentRepository.js";
import { CacheService } from "../services/cacheService.js";
import { DocumentService } from "../services/documentService.js";
import { DocumentRouter } from "../routes/documentRouter.js";
import { FqnDocumentMap } from "../util/fqnHelpers.js";
import { ProcessingContext } from "../services/interfaces/processingContext.js";
import { PATH_CONSTANTS } from "../constant.js";

interface FactoryOptions {
  sourceType: OptSourceType;
  baseUrl: string;
  authMethods: OptAuthMethod[];
  fqnDocumentMap: FqnDocumentMap;
  documentsSubDirectory?: string;
  githubOpts?: GithubOpts;
  ordDirectory?: string;
}

export class RouterFactory {
  public static async createRouter(options: FactoryOptions): Promise<DocumentRouter> {
    const cacheService = new CacheService();

    let repository: DocumentRepository;
    let processingContext: ProcessingContext;
    const documentsSubDirectory = options.documentsSubDirectory || PATH_CONSTANTS.DOCUMENTS_SUBDIRECTORY;

    if (options.sourceType === OptSourceType.Github && options.githubOpts) {
      repository = new GithubDocumentRepository(options.githubOpts);
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

    const documentService = new DocumentService(repository, cacheService, processingContext, documentsSubDirectory);

    // Ensure FQN map is generated and retrieve it
    // Calling getFqnMap also ensures ensureDataLoaded has run
    const fqnDocumentMap = await documentService.getFqnMap();

    const routerOptions = {
      baseUrl: options.baseUrl,
      authMethods: options.authMethods,
      fqnDocumentMap: fqnDocumentMap,
      documentsSubDirectory: documentsSubDirectory,
    };

    return new DocumentRouter(documentService, routerOptions);
  }
}
