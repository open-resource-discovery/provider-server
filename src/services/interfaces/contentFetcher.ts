export interface ContentFetchProgress {
  totalFiles: number;
  fetchedFiles: number;
  currentFile?: string;
  startTime: Date;
  errors: string[];
}

export interface ContentMetadata {
  commitHash: string;
  fetchTime: Date;
  branch: string;
  repository: string;
  totalFiles: number;
}

export interface ContentFetcher {
  fetchAllContent(targetDir: string, onProgress?: (progress: ContentFetchProgress) => void): Promise<ContentMetadata>;
  fetchLatestChanges(targetDir: string, since?: Date): Promise<ContentMetadata>;
  abortFetch(): void;
  getLatestCommitSha(): Promise<string>;
}
