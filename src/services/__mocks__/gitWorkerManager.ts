import { EventEmitter } from "events";

interface GitOperationData {
  url?: string;
  dir?: string;
  ref?: string;
  ours?: string;
  theirs?: string;
  singleBranch?: boolean;
  depth?: number;
  fastForward?: boolean;
  force?: boolean;
  auth?: { username: string; password: string };
}

interface GitOperation {
  type: "clone" | "fetch" | "merge" | "checkout";
  data: GitOperationData;
}

interface GitProgressEvent {
  phase: string;
  loaded?: number;
  total?: number;
}

// Mock implementation that runs git operations synchronously in tests
export class GitWorkerManager extends EventEmitter {
  private readonly currentOperation: Promise<void> | null = null;

  public async clone(
    _url: string,
    _dir: string,
    _ref: string,
    _auth?: { username: string; password: string },
    onProgress?: (progress: GitProgressEvent) => void,
  ): Promise<void> {
    // Mock implementation - immediately resolve
    if (onProgress) {
      onProgress({ phase: "Receiving objects", loaded: 100, total: 100 });
    }
    return await Promise.resolve();
  }

  public async fetch(_dir: string, _ref: string, _auth?: { username: string; password: string }): Promise<void> {
    // Mock implementation - immediately resolve
    return await Promise.resolve();
  }

  public async merge(_dir: string, _ours: string, _theirs: string): Promise<void> {
    // Mock implementation - immediately resolve
    return await Promise.resolve();
  }

  public async checkout(_dir: string, _ref: string, _force: boolean = false): Promise<void> {
    // Mock implementation - immediately resolve
    return await Promise.resolve();
  }

  public abort(): void {
    // Mock implementation - do nothing
  }

  public destroy(): void {
    // Mock implementation - do nothing
  }

  public executeOperation(_operation: GitOperation, onProgress?: (progress: GitProgressEvent) => void): Promise<void> {
    // Mock implementation - immediately resolve
    if (onProgress) {
      onProgress({ phase: "Complete", loaded: 100, total: 100 });
    }
    return Promise.resolve();
  }
}
