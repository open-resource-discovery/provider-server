export enum OptSourceType {
  Local = "local",
  Github = "github",
}

export function parseSourceType(value: string): OptSourceType {
  return Object.values(OptSourceType).some((st) => String(st) === value)
    ? (value as OptSourceType)
    : OptSourceType.Local;
}

export enum OptAuthMethod {
  Open = "open",
  Basic = "basic",
  MTLS = "mtls",
}

export enum OrdAccessStrategy {
  Open = "open",
  Basic = "sap.businesshub:basic-auth:v1",
  MTLS = "sap:cmp-mtls:v1",
}

const optAuthToOrdAccessStrategyMap = {
  [OptAuthMethod.Open]: OrdAccessStrategy.Open,
  [OptAuthMethod.Basic]: OrdAccessStrategy.Basic,
  [OptAuthMethod.MTLS]: OrdAccessStrategy.MTLS,
};

export function mapOptAuthToOrdAccessStrategy(optAuthMethod: OptAuthMethod): OrdAccessStrategy {
  return optAuthToOrdAccessStrategyMap[optAuthMethod];
}

export function parseAuthMethods(value: string): OptAuthMethod[] {
  if (!value) return [OptAuthMethod.Open];
  return value
    .split(",")
    .map((method) => method.trim().toLowerCase())
    .filter((method) => Object.values(OptAuthMethod).includes(method as OptAuthMethod)) as OptAuthMethod[];
}

export interface CommandLineOptions {
  sourceType: OptSourceType;
  directory?: string;
  documentsSubdirectory: string;
  auth: OptAuthMethod[];
  baseUrl?: string;
  host?: string;
  port?: string;
  githubApiUrl?: string;
  githubBranch?: string;
  githubRepository?: string;
  githubToken?: string;
  mtlsCaPath?: string;
  mtlsCertPath?: string;
  mtlsKeyPath?: string;
  mtlsRejectUnauthorized?: boolean;
}
