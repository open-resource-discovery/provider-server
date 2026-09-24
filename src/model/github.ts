import { omitUndefined } from "../util/util.js";

export interface GitHubInstance {
  host: string;
  repo: string;
  branch: string;
}

export interface GitHubFileResponse {
  [key: string]: unknown;

  name: string;
  encoding: string;
  content: string;
  sha: string;
}

export interface GitHubTree {
  path: string;
  mode: string;
  type: string;
  size: number;
  sha: string;
  url: string;
}

export interface GitHubTreeResponse {
  [key: string]: unknown;
  tree: GitHubTree[];
  truncated: boolean;
}

export interface GithubOpts {
  githubApiUrl: string;
  githubRepository: string;
  githubBranch: string;
  githubToken?: string;
  customDirectory?: string;
}

export interface GithubConfig {
  apiUrl: string;
  owner: string;
  repo: string;
  branch: string;
  token?: string;
  rootDirectory: string;
}

export function buildGithubConfig(opts: {
  apiUrl: string;
  repository: string;
  branch: string;
  token?: string;
  rootDirectory?: string;
}): GithubConfig {
  const [owner, repo] = opts.repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: "${opts.repository}" — expected "owner/repo"`);
  }
  return {
    apiUrl: opts.apiUrl,
    owner,
    repo,
    branch: opts.branch,
    ...omitUndefined({ token: opts.token }),
    rootDirectory: opts.rootDirectory || ".",
  };
}
