import { createRequire } from "module";
import { Worker } from "worker_threads";

const require = createRequire(import.meta.url);

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

interface WorkerMessage {
  type: "progress" | "result";
  data?: { success: boolean } | GitProgressEvent;
  error?: string;
}

export class GitWorkerManager {
  private worker: Worker | null = null;
  private currentOperation: Promise<void> | null = null;
  private progressCallback?: (progress: GitProgressEvent) => void;

  private ensureWorker(): Worker {
    if (!this.worker) {
      const workerPath = require.resolve("../workers/gitOperationsWorker.js");
      this.worker = new Worker(workerPath);
    }
    return this.worker;
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public executeOperation(operation: GitOperation, onProgress?: (progress: GitProgressEvent) => void): Promise<void> {
    this.progressCallback = onProgress;

    return new Promise((resolve, reject) => {
      try {
        const worker = this.ensureWorker();

        const cleanup = (): void => {
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          worker.off("message", messageHandler);
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          worker.off("error", errorHandler);
        };

        const errorHandler = (error: Error): void => {
          cleanup();
          reject(error);
        };

        const messageHandler = (message: WorkerMessage): void => {
          if (message.type === "progress" && this.progressCallback) {
            this.progressCallback(message.data as GitProgressEvent);
          } else if (message.type === "result") {
            cleanup();

            if (message.error) {
              reject(new Error(message.error));
            } else {
              resolve();
            }
          }
        };

        worker.on("message", messageHandler);
        worker.on("error", errorHandler);

        // Send the operation to the worker
        worker.postMessage(operation);
      } catch (error) {
        reject(error);
      }
    });
  }

  public async clone(
    url: string,
    dir: string,
    ref: string,
    auth?: { username: string; password: string },
    onProgress?: (progress: GitProgressEvent) => void,
  ): Promise<void> {
    this.currentOperation = this.executeOperation(
      {
        type: "clone",
        data: {
          url,
          dir,
          ref,
          singleBranch: true,
          depth: 1,
          auth,
        },
      },
      onProgress,
    );

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  public async fetch(dir: string, ref: string, auth?: { username: string; password: string }): Promise<void> {
    this.currentOperation = this.executeOperation({
      type: "fetch",
      data: {
        dir,
        ref,
        singleBranch: true,
        auth,
      },
    });

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  public async merge(dir: string, ours: string, theirs: string): Promise<void> {
    this.currentOperation = this.executeOperation({
      type: "merge",
      data: {
        dir,
        ours,
        theirs,
        fastForward: true,
      },
    });

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  public async checkout(dir: string, ref: string, force: boolean = false): Promise<void> {
    this.currentOperation = this.executeOperation({
      type: "checkout",
      data: {
        dir,
        ref,
        force,
      },
    });

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  public abort(): void {
    if (this.worker && this.currentOperation) {
      // Send abort message to worker
      this.worker.postMessage({ type: "abort" });
      // Terminate the worker to ensure the operation stops
      this.terminateWorker();
      this.currentOperation = null;
    }
  }

  public destroy(): void {
    this.abort();
    this.terminateWorker();
  }
}
