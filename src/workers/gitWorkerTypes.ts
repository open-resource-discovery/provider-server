export interface GitOperationData {
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

export interface GitOperation {
  type: "clone" | "checkout" | "resetIndex" | "pull";
  data: GitOperationData;
}

export interface GitProgressEvent {
  phase: string;
  loaded?: number;
  total?: number;
}

export interface WorkerMessage {
  type: "progress" | "result";
  data?: { success: boolean } | GitProgressEvent;
  error?: string;
}
