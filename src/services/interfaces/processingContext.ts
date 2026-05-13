import { OptAuthMethod } from "../../model/cli.js";

export interface ProcessingContext {
  baseUrl: string;
  absoluteUrls?: boolean;
  authMethods: OptAuthMethod[];
  documentsSubDirectory?: string;
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepo?: string;
  githubToken?: string;
}
