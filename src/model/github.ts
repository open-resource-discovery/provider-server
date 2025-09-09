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

export type FetchStrategy = "api" | "clone" | "archive";

export interface GithubConfig {
  apiUrl: string;
  owner: string;
  repo: string;
  branch: string;
  token?: string;
  rootDirectory: string;
  fetchStrategy?: FetchStrategy;
}

export function buildGithubConfig(opts: {
  apiUrl: string;
  repository: string;
  branch: string;
  token?: string;
  rootDirectory?: string;
  fetchStrategy?: FetchStrategy;
}): GithubConfig {
  const [owner, repo] = opts.repository.split("/");
  return {
    apiUrl: opts.apiUrl,
    owner,
    repo,
    branch: opts.branch,
    token: opts.token,
    rootDirectory: opts.rootDirectory || ".",
    fetchStrategy: opts.fetchStrategy || "clone",
  };
}
