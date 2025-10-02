import { EventEmitter } from "events";
import { ContentFetchProgress } from "../services/interfaces/contentFetcher.js";
import { Logger } from "pino";
import { log as defaultLogger } from "./logger.js";

export interface ProgressHandlerOptions {
  logInterval?: number;
  emitter?: EventEmitter;
  emitEvent?: string;
  logger?: Logger;
}

export function createProgressHandler(options: ProgressHandlerOptions = {}): (progress: ContentFetchProgress) => void {
  const { logInterval = 3000, emitter, emitEvent = "update-progress", logger = defaultLogger } = options;

  let lastLogTime = Date.now();

  return (progress: ContentFetchProgress): void => {
    if (emitter && emitEvent) {
      emitter.emit(emitEvent, progress);
    }

    // Log progress at specified intervals
    const now = Date.now();
    if (now - lastLogTime >= logInterval) {
      const fetchedFiles = progress.fetchedFiles || 0;
      const totalFiles = progress.totalFiles || 0;

      const percentage = totalFiles > 0 ? Math.min(99, Math.round((fetchedFiles / totalFiles) * 100)) : 0;

      const phase = progress.phase || "Syncing";

      if (totalFiles > 0) {
        logger.info(`${phase}: ${percentage}% (${fetchedFiles}/${totalFiles} git objects)`);
      }

      lastLogTime = now;
    }
  };
}
