import { createRequire } from "module";
import { Worker } from "worker_threads";
import { GitOperation, GitProgressEvent, WorkerMessage } from "../workers/gitWorkerTypes.js";

const require = createRequire(import.meta.url);

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

  public async resetIndex(dir: string): Promise<void> {
    this.currentOperation = this.executeOperation({
      type: "resetIndex",
      data: {
        dir,
      },
    });

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  public async pull(dir: string, ref?: string, auth?: { username: string; password: string }): Promise<void> {
    this.currentOperation = this.executeOperation({
      type: "pull",
      data: {
        dir,
        ref,
        auth,
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
