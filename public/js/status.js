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
      contentMetric: document.querySelector(".metric.metric-full.copyable"),
      // Settings elements
      settingsToggle: document.getElementById("settingsToggle"),
      settingsContent: document.getElementById("settingsContent"),
      toggleIcon: document.querySelector("#settingsToggle .toggle-icon"),
      settingSourceType: document.getElementById("settingSourceType"),
      settingBaseUrl: document.getElementById("settingBaseUrl"),
      settingDirectory: document.getElementById("settingDirectory"),
      settingAuth: document.getElementById("settingAuth"),
      settingGithubUrl: document.getElementById("settingGithubUrl"),
      settingGithubRepo: document.getElementById("settingGithubRepo"),
      settingGithubBranch: document.getElementById("settingGithubBranch"),
      settingUpdateDelay: document.getElementById("settingUpdateDelay"),
      githubUrlSetting: document.getElementById("githubUrlSetting"),
      githubRepoSetting: document.getElementById("githubRepoSetting"),
      githubBranchSetting: document.getElementById("githubBranchSetting"),
      updateDelaySetting: document.getElementById("updateDelaySetting"),
      githubActions: document.getElementById("githubActions"),
      githubRepoButton: document.getElementById("githubRepoButton"),
    };

    this.connect();
    this.startHealthCheck();
    this.updateFooterTime();
    setInterval(() => this.updateFooterTime(), 1000);
    this.initTheme();
    this.initSettingsToggle();
    this.initCopyButtons();
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

  initSettingsToggle() {
    this.elements.settingsToggle.addEventListener("click", () => {
      const isOpen = this.elements.settingsContent.style.display !== "none";
      
      if (isOpen) {
        this.elements.settingsContent.style.display = "none";
        this.elements.toggleIcon.textContent = "▶";
      } else {
        this.elements.settingsContent.style.display = "block";
        this.elements.toggleIcon.textContent = "▼";
      }
    });
  }

  updateSettingsDisplay() {
    if (!this.serverSettings) return;

    // Update basic settings
    this.elements.settingSourceType.textContent = this.serverSettings.sourceType || "-";
    this.elements.settingBaseUrl.textContent = this.serverSettings.baseUrl || "-";
    this.elements.settingDirectory.textContent = this.serverSettings.directory || "-";
    this.elements.settingAuth.textContent = this.serverSettings.authMethods || "-";

    // Show/hide GitHub-specific settings
    const isGithub = this.serverSettings.sourceType === "github";
    const isLocal = this.serverSettings.sourceType === "local";
    
    // Hide Content card in local mode
    if (this.elements.contentMetric) {
      this.elements.contentMetric.style.display = isLocal ? "none" : "block";
    }
    
    if (isGithub) {
      this.elements.githubUrlSetting.style.display = "block";
      this.elements.githubRepoSetting.style.display = "block";
      this.elements.githubBranchSetting.style.display = "block";
      this.elements.updateDelaySetting.style.display = "block";
      this.elements.githubActions.style.display = "block";

      this.elements.settingGithubUrl.textContent = this.serverSettings.githubUrl || "-";
      this.elements.settingGithubRepo.textContent = this.serverSettings.githubRepository || "-";
      this.elements.settingGithubBranch.textContent = this.serverSettings.githubBranch || "-";
      this.elements.settingUpdateDelay.textContent = this.serverSettings.updateDelay ? `${this.serverSettings.updateDelay}s` : "-";

      // Update GitHub repository button to point to commit
      if (this.serverSettings.githubRepository) {
        let url;
        // Derive base URL from API URL
        let baseUrl = "https://github.com";
        if (this.serverSettings.githubUrl && this.serverSettings.githubUrl !== "https://api.github.com") {
          // For GitHub Enterprise, convert API URL to web URL
          // e.g., https://api.github.enterprise.com -> https://github.enterprise.com
          // or https://github.enterprise.com/api/v3 -> https://github.enterprise.com
          const apiUrl = this.serverSettings.githubUrl;
          if (apiUrl.includes("/api/v3")) {
            baseUrl = apiUrl.replace("/api/v3", "");
          } else if (apiUrl.includes("api.")) {
            baseUrl = apiUrl.replace("api.", "");
          } else {
            // Fallback: remove /api if present
            baseUrl = apiUrl.replace(/\/api$/, "");
          }
        }
        
        if (this.serverSettings.commitHash && this.serverSettings.commitHash !== "current") {
          // Link to specific commit
          url = `${baseUrl}/${this.serverSettings.githubRepository}/commit/${this.serverSettings.commitHash}`;
          this.elements.githubRepoButton.querySelector(".btn-text").textContent = "View Commit";
        } else {
          // Fallback to repository with branch
          url = `${baseUrl}/${this.serverSettings.githubRepository}/tree/${this.serverSettings.githubBranch || "main"}`;
          this.elements.githubRepoButton.querySelector(".btn-text").textContent = "View Repository";
        }
        this.elements.githubRepoButton.href = url;
      }
    } else {
      this.elements.githubUrlSetting.style.display = "none";
      this.elements.githubRepoSetting.style.display = "none";
      this.elements.githubBranchSetting.style.display = "none";
      this.elements.updateDelaySetting.style.display = "none";
      this.elements.githubActions.style.display = "none";
    }
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

  handleError() {
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

    // Store settings data for later use
    if (data.settings) {
      this.serverSettings = data.settings;
      // Store commit hash from content if available
      if (data.content && data.content.commitHash) {
        this.serverSettings.commitHash = data.content.commitHash;
      }
      this.updateSettingsDisplay();
    }

    this.updateServerHealth(true);
  }

  updateStatusBadge(status) {
    const badge = this.elements.updateStatus;
    badge.setAttribute("data-status", status);

    const statusText = {
      idle: "SYNCED",
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

    // Disable button in local mode
    const isLocalMode = this.serverSettings && this.serverSettings.sourceType === "local";
    if (isLocalMode) {
      button.disabled = true;
      if (buttonText) {
        buttonText.textContent = "N/A - Local Mode";
      }
      return;
    }

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
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
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
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    this.elements.footerTime.textContent = `${hours}:${minutes}:${seconds}`;

    this.updateLastHealthCheck();
  }

  initCopyButtons() {
    // Use event delegation for copy functionality
    document.addEventListener("click", async (e) => {
      let targetElement = null;
      let copyButton = null;
      
      // Check if clicked on copy button
      if (e.target.classList.contains("copy-button")) {
        copyButton = e.target;
        const targetId = copyButton.getAttribute("data-copy-target");
        targetElement = document.getElementById(targetId);
      }
      // Check if clicked on copyable setting item or metric
      else if (e.target.closest(".setting-item.copyable") || e.target.closest(".metric.copyable")) {
        const copyableItem = e.target.closest(".setting-item.copyable") || e.target.closest(".metric.copyable");
        targetElement = copyableItem.querySelector("value");
        copyButton = copyableItem.querySelector(".copy-button");
      }
      
      if (targetElement && targetElement.textContent !== "-") {
        const textToCopy = targetElement.textContent;
        
        try {
          await navigator.clipboard.writeText(textToCopy);
          
          // Show success feedback on button if available
          if (copyButton) {
            const originalText = copyButton.textContent;
            copyButton.textContent = "Copied!";
            copyButton.classList.add("copied");
            
            // Reset after 2 seconds
            setTimeout(() => {
              copyButton.textContent = originalText;
              copyButton.classList.remove("copied");
            }, 2000);
          }
          
          // Also show brief flash effect on the item
          const item = targetElement.closest(".setting-item") || targetElement.closest(".metric");
          if (item) {
            item.style.background = "rgba(29, 191, 176, 0.1)";
            setTimeout(() => {
              item.style.background = "";
            }, 300);
          }
        } catch (err) {
          console.error("Failed to copy text:", err);
        }
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.statusClient = new StatusClient();
});
