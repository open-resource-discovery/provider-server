import { parentPort } from "worker_threads";
import * as fs from "fs/promises";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import type { GitOperationData, GitProgressEvent } from "./gitWorkerTypes.js";

interface WorkerMessage {
  type: "clone" | "checkout" | "resetIndex" | "pull" | "abort";
  data?: GitOperationData;
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
      case "checkout":
        if (!message.data) {
          throw new Error("Checkout operation requires data");
        }
        await this.handleCheckout(message.data);
        break;
      case "resetIndex":
        if (!message.data) {
          throw new Error("Reset index operation requires data");
        }
        await this.handleResetIndex(message.data);
        break;
      case "pull":
        if (!message.data) {
          throw new Error("Pull operation requires data");
        }
        await this.handlePull(message.data);
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

  private async handleCheckout(data: GitOperationData): Promise<void> {
    await git.checkout({
      fs,
      dir: data.dir!,
      ref: data.ref!,
      force: data.force!,
    });

    this.sendResult({ success: true });
  }

  private async handleResetIndex(data: GitOperationData): Promise<void> {
    await git.resetIndex({
      fs,
      dir: data.dir!,
      filepath: ".",
    });

    this.sendResult({ success: true });
  }

  private async handlePull(data: GitOperationData): Promise<void> {
    await git.pull({
      fs,
      http,
      dir: data.dir!,
      ref: data.ref,
      singleBranch: true,
      fastForward: true,
      onAuth: data.auth ? (): { username: string; password: string } => data.auth! : undefined,
      // TODO
      author: {
        name: "ORD Provider Server",
        email: "noreply@ord-provider-server",
      },
    });

    this.sendResult({ success: true });
  }
}

new GitWorker();
