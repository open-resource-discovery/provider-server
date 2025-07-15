// Extend window interface
interface StatusElements {
  connectionStatus: HTMLElement;
  updateStatus: HTMLElement;
  version: HTMLElement;
  contentVersion: HTMLElement;
  lastUpdate: HTMLElement;
  scheduledTime: HTMLElement;
  scheduledMetric: HTMLElement;
  updateButton: HTMLButtonElement;
  buttonHint: HTMLElement;
  serverHealth: HTMLElement;
  lastHealthCheck: HTMLElement;
  footerTime: HTMLElement;
  themeToggle: HTMLElement;
  themeIcon: HTMLElement;
}

class StatusClient {
  private ws: WebSocket | null = null;
  private reconnectInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastHealthCheck = new Date();
  private readonly elements: StatusElements;
  private isManualTrigger = false;

  public constructor() {
    // DOM elements
    this.elements = {
      connectionStatus: document.getElementById("connectionStatus")!,
      updateStatus: document.getElementById("updateStatus")!,
      version: document.getElementById("version")!,
      contentVersion: document.getElementById("contentVersion")!,
      lastUpdate: document.getElementById("lastUpdate")!,
      scheduledTime: document.getElementById("scheduledTime")!,
      scheduledMetric: document.getElementById("scheduledMetric")!,
      updateButton: document.getElementById("updateButton")! as HTMLButtonElement,
      buttonHint: document.getElementById("buttonHint")!,
      serverHealth: document.getElementById("serverHealth")!,
      lastHealthCheck: document.getElementById("lastHealthCheck")!,
      footerTime: document.getElementById("footerTime")!,
      themeToggle: document.getElementById("themeToggle")!,
      themeIcon: document.querySelector("#themeToggle .theme-icon")!,
    };
    this.connect();
    this.startHealthCheck();
    this.updateFooterTime();
    setInterval((): void => this.updateFooterTime(), 1000);
    this.initTheme();
  }

  private initTheme(): void {
    // Check for saved theme preference or default to dark mode
    const savedTheme = localStorage.getItem("theme");
    const theme = savedTheme || "dark";

    // Apply theme
    document.body.setAttribute("data-theme", theme);
    this.updateThemeIcon(theme);

    // Add click handler
    this.elements.themeToggle.addEventListener("click", (): void => {
      const currentTheme = document.body.getAttribute("data-theme") || "light";
      const newTheme = currentTheme === "light" ? "dark" : "light";

      document.body.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      this.updateThemeIcon(newTheme);
    });
  }

  private updateThemeIcon(theme: string): void {
    this.elements.themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  }

  private connect(): void {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = (): void => this.handleOpen();
      this.ws.onmessage = (event): void => this.handleMessage(event);
      this.ws.onerror = (error): void => this.handleError(error);
      this.ws.onclose = (): void => this.handleClose();
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    this.reconnectDelay = 1000;
    this.updateConnectionStatus("connected");

    // Clear reconnect interval if it exists
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    // Request initial status
    this.sendMessage({ type: "status" });
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "status":
          this.updateStatus(data.data);
          break;
        case "update-started":
          this.handleUpdateStarted();
          break;
        case "update-completed":
          this.handleUpdateCompleted();
          break;
        case "update-failed":
          this.handleUpdateFailed(data.error);
          break;
        case "update-scheduled":
          this.handleUpdateScheduled(data.scheduledTime);
          break;
        case "update-progress":
          // Progress updates - could display progress in UI if desired
          // For now, just acknowledge them silently
          break;
        case "health":
          this.updateHealth(data.data);
          break;
        default:
        // Unknown message type - ignore silently
      }
    } catch {
      // Failed to parse message - ignore silently
    }
  }

  private handleError(_error: Event): void {
    this.updateConnectionStatus("disconnected");
  }

  private handleClose(): void {
    this.updateConnectionStatus("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectInterval) return;

    this.reconnectInterval = setInterval((): void => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private sendMessage(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private updateConnectionStatus(status: string): void {
    const indicator = this.elements.connectionStatus;
    indicator.setAttribute("data-status", status);
    indicator.title = status === "connected" ? "Connected" : "Disconnected";
  }

  private updateStatus(data: Record<string, unknown>): void {
    // Server version
    if (data.version) {
      this.elements.version.textContent = String(data.version);
    }

    // Content data
    const content = data.content as Record<string, unknown> | undefined;
    if (content) {
      // Content version
      this.elements.contentVersion.textContent = String(content.currentVersion || "No version");

      // Last update time
      this.elements.lastUpdate.textContent = content.lastFetchTime
        ? this.formatDate(new Date(String(content.lastFetchTime)))
        : "Never";

      // Update status
      const updateStatus = String(content.updateStatus);
      this.updateStatusBadge(updateStatus);

      // Scheduled time
      if (content.scheduledUpdateTime) {
        this.elements.scheduledMetric.style.display = "block";
        this.elements.scheduledTime.textContent = this.formatDate(new Date(String(content.scheduledUpdateTime)));
      } else {
        this.elements.scheduledMetric.style.display = "none";
      }

      // Update button state
      this.updateButtonState(updateStatus);

      // Clear hint text if status is idle
      if (updateStatus === "idle") {
        this.elements.buttonHint.textContent = "";
      }
    }

    // Update server health
    this.updateServerHealth(true);
  }

  private updateStatusBadge(status: string): void {
    const badge = this.elements.updateStatus;
    badge.setAttribute("data-status", status);

    const statusText: { [key: string]: string } = {
      idle: "IDLE",
      scheduled: "SCHEDULED",
      in_progress: "IN PROGRESS",
      failed: "FAILED",
      unknown: "UNKNOWN",
    };

    const statusTextDom = badge.querySelector(".status-text");
    if (statusTextDom) {
      statusTextDom.textContent = statusText[status] || "UNKNOWN";
    }
  }

  private updateButtonState(status: string): void {
    const button = this.elements.updateButton;
    const buttonText = button.querySelector<HTMLElement>(".btn-text");
    const spinner = button.querySelector<HTMLElement>(".btn-spinner");

    // Don't update if manual trigger is in progress
    if (this.isManualTrigger) return;

    const isIdle = status === "idle" || status === "failed";
    button.disabled = !isIdle;

    // Update button text
    if (buttonText) {
      if (status === "idle" || status === "failed") {
        buttonText.textContent = "Trigger Update";
        this.elements.buttonHint.textContent = "";
      } else if (status === "scheduled") {
        buttonText.textContent = "Update Scheduled";
        this.elements.buttonHint.textContent = "Update will start automatically";
      } else if (status === "in_progress") {
        buttonText.textContent = "Update In Progress";
        this.elements.buttonHint.textContent = "Please wait...";
      }
    }

    // Show/hide spinner
    if (spinner && buttonText) {
      spinner.style.display = status === "in_progress" ? "block" : "none";
      buttonText.style.opacity = status === "in_progress" ? "0" : "1";
    }
  }

  public async triggerUpdate(): Promise<void> {
    const button = this.elements.updateButton;
    const buttonText = button.querySelector<HTMLElement>(".btn-text");
    const spinner = button.querySelector<HTMLElement>(".btn-spinner");

    this.isManualTrigger = true;
    button.disabled = true;
    if (buttonText) {
      buttonText.textContent = "Scheduling...";
    }
    this.elements.buttonHint.textContent = "";

    try {
      const response = await fetch("/api/v1/webhook/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Manual-Trigger": "true",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("Failed to trigger update");
      }

      // Don't update the button state here - let the WebSocket update handle it
      if (buttonText && spinner) {
        buttonText.textContent = "Scheduling...";
        spinner.style.display = "block";
        buttonText.style.opacity = "0";
      }
      this.elements.buttonHint.textContent = "Requesting update...";

      // Reset manual trigger after a delay to allow WebSocket updates
      setTimeout(() => {
        this.isManualTrigger = false;
      }, 5000);

      // Failsafe: Reset button state if no update received within 10 seconds
      setTimeout(() => {
        // Check if spinner is still visible (meaning we're still waiting)
        if (spinner && spinner.style.display === "block") {
          this.isManualTrigger = false;
          if (buttonText) {
            buttonText.textContent = "Trigger Update";
            buttonText.style.opacity = "1";
          }
          spinner.style.display = "none";
          button.disabled = false;
          this.elements.buttonHint.textContent = "";
        }
      }, 10000);
    } catch {
      if (buttonText && spinner) {
        buttonText.textContent = "Error - Try Again";
        spinner.style.display = "none";
        buttonText.style.opacity = "1";
      }
      button.disabled = false;
      this.elements.buttonHint.textContent = "Failed to schedule update";
      this.isManualTrigger = false;
    }
  }

  private handleUpdateStarted(): void {
    this.updateStatusBadge("in_progress");
    this.updateButtonState("in_progress");
    // Clear manual trigger flag when update starts
    this.isManualTrigger = false;
    // Clear hint text
    this.elements.buttonHint.textContent = "";
  }

  private handleUpdateCompleted(): void {
    // Clear manual trigger flag so button updates properly
    this.isManualTrigger = false;
    // Clear hint text
    this.elements.buttonHint.textContent = "";
    // Request fresh status
    this.sendMessage({ type: "status" });
  }

  private handleUpdateFailed(error: string): void {
    // Clear manual trigger flag
    this.isManualTrigger = false;
    this.updateStatusBadge("failed");
    this.updateButtonState("failed");
    this.elements.buttonHint.textContent = error || "Update failed";
  }

  private handleUpdateScheduled(scheduledTime: string): void {
    this.elements.scheduledMetric.style.display = "block";
    this.elements.scheduledTime.textContent = this.formatDate(new Date(scheduledTime));
    this.updateStatusBadge("scheduled");
    this.updateButtonState("scheduled");
    // Clear manual trigger flag when update is scheduled
    this.isManualTrigger = false;
    // Clear hint text
    this.elements.buttonHint.textContent = "";
  }

  private startHealthCheck(): void {
    // Initial health check
    this.performHealthCheck();

    // Schedule regular health checks
    this.healthCheckInterval = setInterval((): void => {
      this.performHealthCheck();
    }, 5000);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const response = await fetch("/health", {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });

      const isHealthy = response.ok;
      this.updateServerHealth(isHealthy);

      if (isHealthy) {
        const data = await response.json();
        this.updateHealth(data);
      }
    } catch {
      this.updateServerHealth(false);
    }

    this.lastHealthCheck = new Date();
    this.updateLastHealthCheck();
  }

  private updateHealth(data: Record<string, string>): void {
    // Update server health based on response
    this.updateServerHealth(data.status === "ok");
  }

  private updateServerHealth(isHealthy: boolean): void {
    const element = this.elements.serverHealth;
    element.setAttribute("data-status", isHealthy ? "healthy" : "unhealthy");
    element.textContent = isHealthy ? "Healthy" : "Unhealthy";
  }

  private updateLastHealthCheck(): void {
    this.elements.lastHealthCheck.textContent = this.formatRelativeTime(this.lastHealthCheck);
  }

  private formatDate(date: Date): string {
    return date.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    });
  }

  private formatRelativeTime(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    return this.formatDate(date);
  }

  private updateFooterTime(): void {
    const now = new Date();
    this.elements.footerTime.textContent = now.toLocaleTimeString();

    // Update relative times
    this.updateLastHealthCheck();
  }
}

// Initialize client when DOM is ready
document.addEventListener("DOMContentLoaded", (): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).statusClient = new StatusClient();
});
