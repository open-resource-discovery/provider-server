class StatusClient {
  constructor() {
    this.ws = null;
    this.reconnectInterval = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.healthCheckInterval = null;
    this.lastHealthCheck = new Date();
    this.isManualTrigger = false;

    this.elements = {
      connectionStatus: document.getElementById("connectionStatus"),
      updateStatus: document.getElementById("updateStatus"),
      version: document.getElementById("version"),
      contentVersion: document.getElementById("contentVersion"),
      lastUpdate: document.getElementById("lastUpdate"),
      scheduledTime: document.getElementById("scheduledTime"),
      scheduledMetric: document.getElementById("scheduledMetric"),
      updateButton: document.getElementById("updateButton"),
      buttonHint: document.getElementById("buttonHint"),
      serverHealth: document.getElementById("serverHealth"),
      lastHealthCheck: document.getElementById("lastHealthCheck"),
      footerTime: document.getElementById("footerTime"),
      themeToggle: document.getElementById("themeToggle"),
      themeIcon: document.querySelector("#themeToggle .theme-icon"),
    };

    this.connect();
    this.startHealthCheck();
    this.updateFooterTime();
    setInterval(() => this.updateFooterTime(), 1000);
    this.initTheme();
  }

  initTheme() {
    const savedTheme = localStorage.getItem("theme");
    const theme = savedTheme || "dark";

    document.body.setAttribute("data-theme", theme);
    this.updateThemeIcon(theme);

    this.elements.themeToggle.addEventListener("click", () => {
      const currentTheme = document.body.getAttribute("data-theme") || "light";
      const newTheme = currentTheme === "light" ? "dark" : "light";

      document.body.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      this.updateThemeIcon(newTheme);
    });
  }

  updateThemeIcon(theme) {
    this.elements.themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  }

  connect() {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onclose = () => this.handleClose();
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      this.scheduleReconnect();
    }
  }

  handleOpen() {
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

  handleMessage(event) {
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
          this.handleUpdateProgress(data.data);
          break;
        case "health":
          this.updateHealth(data.data);
          break;
        default:
      }
    } catch {
      // Failed to parse message - ignore silently
    }
  }

  handleError(error) {
    this.updateConnectionStatus("disconnected");
  }

  handleClose() {
    this.updateConnectionStatus("disconnected");
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectInterval) return;

    this.reconnectInterval = setInterval(() => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  updateConnectionStatus(status) {
    const indicator = this.elements.connectionStatus;
    indicator.setAttribute("data-status", status);
    indicator.title = status === "connected" ? "Connected" : "Disconnected";
  }

  updateStatus(data) {
    if (data.version) {
      this.elements.version.textContent = String(data.version);
    }

    const content = data.content;
    if (content) {
      this.elements.contentVersion.textContent = String(content.currentVersion || "No version");

      this.elements.lastUpdate.textContent = content.lastFetchTime
        ? this.formatDate(new Date(String(content.lastFetchTime)))
        : "Never";

      const updateStatus = String(content.updateStatus);
      this.updateStatusBadge(updateStatus);

      if (content.scheduledUpdateTime) {
        this.elements.scheduledMetric.style.display = "block";
        this.elements.scheduledTime.textContent = this.formatDate(new Date(String(content.scheduledUpdateTime)));
      } else {
        this.elements.scheduledMetric.style.display = "none";
      }

      this.updateButtonState(updateStatus);

      if (updateStatus === "idle") {
        this.elements.buttonHint.textContent = "";
      }
    }

    this.updateServerHealth(true);
  }

  updateStatusBadge(status) {
    const badge = this.elements.updateStatus;
    badge.setAttribute("data-status", status);

    const statusText = {
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

  updateButtonState(status) {
    const button = this.elements.updateButton;
    const buttonText = button.querySelector(".btn-text");
    const spinner = button.querySelector(".btn-spinner");

    if (this.isManualTrigger) return;

    const isIdle = status === "idle" || status === "failed";
    button.disabled = !isIdle;

    if (buttonText) {
      if (status === "idle" || status === "failed") {
        buttonText.textContent = "Trigger Update";
        this.elements.buttonHint.textContent = "";
      } else if (status === "scheduled") {
        buttonText.textContent = "Update Scheduled";
        this.elements.buttonHint.textContent = "Update will start automatically";
      } else if (status === "in_progress") {
        buttonText.textContent = "Update In Progress";
        this.elements.buttonHint.textContent = "Starting update...";
      }
    }

    if (spinner && buttonText) {
      spinner.style.display = status === "in_progress" ? "block" : "none";
      buttonText.style.opacity = status === "in_progress" ? "0" : "1";
    }
  }

  async triggerUpdate() {
    const button = this.elements.updateButton;
    const buttonText = button.querySelector(".btn-text");
    const spinner = button.querySelector(".btn-spinner");

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

  handleUpdateStarted() {
    this.updateStatusBadge("in_progress");
    this.updateButtonState("in_progress");
    // Clear manual trigger flag when update starts
    this.isManualTrigger = false;
    // Clear hint text
    this.elements.buttonHint.textContent = "";
  }

  handleUpdateCompleted() {
    // Clear manual trigger flag so button updates properly
    this.isManualTrigger = false;
    // Clear hint text
    this.elements.buttonHint.textContent = "";
    // Request fresh status
    this.sendMessage({ type: "status" });
  }

  handleUpdateFailed(error) {
    this.isManualTrigger = false;
    this.updateStatusBadge("failed");
    this.updateButtonState("failed");
    this.elements.buttonHint.textContent = error || "Update failed";
  }

  handleUpdateScheduled(scheduledTime) {
    this.elements.scheduledMetric.style.display = "block";
    this.elements.scheduledTime.textContent = this.formatDate(new Date(scheduledTime));
    this.updateStatusBadge("scheduled");
    this.updateButtonState("scheduled");
    this.isManualTrigger = false;
    this.elements.buttonHint.textContent = "";
  }

  handleUpdateProgress(progress) {
    if (progress) {
      let progressText = "";

      // Show file progress: TODO
      if (progress.totalFiles && progress.fetchedFiles !== undefined) {
        const percentage = Math.round((progress.fetchedFiles / progress.totalFiles) * 100);
        progressText = `Fetching files: ${progress.fetchedFiles}/${progress.totalFiles} (${percentage}%)`;
      }

      // Show current file if available: TODO
      if (progress.currentFile) {
        const fileName = progress.currentFile.split('/').pop();
        progressText += ` - ${fileName}`;
      }

      if (progress.errors && progress.errors.length > 0) {
        progressText += ` [${progress.errors.length} errors]`;
      }

      if (progressText) {
        this.elements.buttonHint.textContent = progressText;
      }
    }
  }

  startHealthCheck() {
    this.performHealthCheck();

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 5000);
  }

  async performHealthCheck() {
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

  updateHealth(data) {
    this.updateServerHealth(data.status === "ok");
  }

  updateServerHealth(isHealthy) {
    const element = this.elements.serverHealth;
    element.setAttribute("data-status", isHealthy ? "healthy" : "unhealthy");
    element.textContent = isHealthy ? "Healthy" : "Unhealthy";
  }

  updateLastHealthCheck() {
    this.elements.lastHealthCheck.textContent = this.formatRelativeTime(this.lastHealthCheck);
  }

  formatDate(date) {
    return date.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    });
  }

  formatRelativeTime(date) {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    return this.formatDate(date);
  }

  updateFooterTime() {
    const now = new Date();
    this.elements.footerTime.textContent = now.toLocaleTimeString();

    this.updateLastHealthCheck();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.statusClient = new StatusClient();
});
