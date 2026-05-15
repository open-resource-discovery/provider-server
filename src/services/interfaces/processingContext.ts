import { OptAuthMethod } from "../../model/cli.js";

export interface ProcessingContext {
  baseUrl: string;
  authMethods: OptAuthMethod[];
  cfMtlsAccessStrategies: string[];
  documentsSubDirectory?: string;
  githubBranch?: string;
  githubApiUrl?: string;
  githubRepo?: string;
  githubToken?: string;
}
