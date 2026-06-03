export class SyncStatusService {
  private static instance: SyncStatusService;
  private _initialSyncComplete = false;
  private _initialSyncInProgress = false;

  private constructor() {}

  public static getInstance(): SyncStatusService {
    if (!SyncStatusService.instance) {
      SyncStatusService.instance = new SyncStatusService();
    }
    return SyncStatusService.instance;
  }

  public get initialSyncComplete(): boolean {
    return this._initialSyncComplete;
  }

  public set initialSyncComplete(value: boolean) {
    this._initialSyncComplete = value;
  }

  public get initialSyncInProgress(): boolean {
    return this._initialSyncInProgress;
  }

  public set initialSyncInProgress(value: boolean) {
    this._initialSyncInProgress = value;
  }

  public getSyncStatus(): { initialSyncComplete: boolean; initialSyncInProgress: boolean } {
    return {
      initialSyncComplete: this._initialSyncComplete,
      initialSyncInProgress: this._initialSyncInProgress,
    };
  }
}
