import { parentPort } from "worker_threads";
import * as fs from "fs/promises";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";

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

interface WorkerMessage {
  type: "clone" | "fetch" | "merge" | "checkout" | "abort";
  data?: GitOperationData;
}

interface GitProgressEvent {
  phase: string;
  loaded?: number;
  total?: number;
}

interface ProgressMessage {
  type: "progress";
  data: GitProgressEvent;
}

interface ResultMessage {
  type: "result";
  data?: { success: boolean };
  error?: string;
}

class GitWorker {
  private abortController: AbortController | null = null;

  public constructor() {
    if (!parentPort) {
      throw new Error("This file must be run as a worker thread");
    }

    parentPort.on("message", (message: WorkerMessage) => {
      this.handleMessage(message).catch((error) => {
        const result: ResultMessage = {
          type: "result",
          error: error instanceof Error ? error.message : String(error),
        };
        parentPort!.postMessage(result);
      });
    });
  }

  private async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case "clone":
        if (!message.data) {
          throw new Error("Clone operation requires data");
        }
        await this.handleClone(message.data);
        break;
      case "fetch":
        if (!message.data) {
          throw new Error("Fetch operation requires data");
        }
        await this.handleFetch(message.data);
        break;
      case "merge":
        if (!message.data) {
          throw new Error("Merge operation requires data");
        }
        await this.handleMerge(message.data);
        break;
      case "checkout":
        if (!message.data) {
          throw new Error("Checkout operation requires data");
        }
        await this.handleCheckout(message.data);
        break;
      case "abort":
        this.handleAbort();
        break;
    }
  }

  private handleAbort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private sendProgress(data: GitProgressEvent): void {
    const message: ProgressMessage = {
      type: "progress",
      data,
    };
    parentPort!.postMessage(message);
  }

  private sendResult(data?: { success: boolean }, error?: string): void {
    const message: ResultMessage = {
      type: "result",
      data,
      error,
    };
    parentPort!.postMessage(message);
  }

  private async handleClone(data: GitOperationData): Promise<void> {
    if (!data.url || !data.dir || !data.ref || data.singleBranch === undefined || data.depth === undefined) {
      throw new Error("Clone operation missing required parameters");
    }
    this.abortController = new AbortController();

    try {
      await git.clone({
        fs,
        http,
        dir: data.dir,
        url: data.url,
        ref: data.ref,
        singleBranch: data.singleBranch,
        depth: data.depth,
        onAuth: data.auth ? (): { username: string; password: string } => data.auth! : undefined,
        onProgress: (progressEvent): void => {
          this.sendProgress(progressEvent as GitProgressEvent);
        },
        // signal: this.abortController.signal, // Not supported in isomorphic-git types
      });

      this.sendResult({ success: true });
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.sendResult(undefined, "Clone operation aborted");
      } else {
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  private async handleFetch(data: GitOperationData): Promise<void> {
    this.abortController = new AbortController();

    try {
      await git.fetch({
        fs,
        http,
        dir: data.dir!,
        ref: data.ref!,
        singleBranch: data.singleBranch!,
        onAuth: data.auth ? (): { username: string; password: string } => data.auth! : undefined,
        // signal: this.abortController.signal, // Not supported in isomorphic-git types
      });

      this.sendResult({ success: true });
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.sendResult(undefined, "Fetch operation aborted");
      } else {
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  private async handleMerge(data: GitOperationData): Promise<void> {
    await git.merge({
      fs,
      dir: data.dir!,
      ours: data.ours!,
      theirs: data.theirs!,
      fastForward: data.fastForward!,
    });

    this.sendResult({ success: true });
  }

  private async handleCheckout(data: GitOperationData): Promise<void> {
    await git.checkout({
      fs,
      dir: data.dir!,
      ref: data.ref!,
      force: data.force!,
    });

    this.sendResult({ success: true });
  }
}

new GitWorker();
