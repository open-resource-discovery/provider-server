import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { log } from "../util/logger.js";
import { FileSystemManager } from "../services/fileSystemManager.js";
import { UpdateScheduler } from "../services/updateScheduler.js";

export function getPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || "unknown";
  } catch (error) {
    log.error("Failed to read package.json version:", error);
    return "unknown";
  }
}

const version = getPackageVersion();

interface StatusRouterOptions extends FastifyPluginOptions {
  fileSystemManager?: FileSystemManager | null;
  updateScheduler?: UpdateScheduler | null;
}

interface StatusResponse {
  version: string;
  content?: {
    lastFetchTime: string | null;
    currentVersion: string | null;
    updateStatus: "idle" | "scheduled" | "in_progress";
    scheduledUpdateTime?: string | null;
    failedUpdates: number;
  };
  github?: {
    repository?: string;
    branch?: string;
  };
}

function statusRouter(fastify: FastifyInstance, opts: StatusRouterOptions, done: (err?: Error) => void): void {
  // JSON API endpoint
  fastify.get("/api/v1/status", async (_request: FastifyRequest, _reply: FastifyReply): Promise<StatusResponse> => {
    const response: StatusResponse = {
      version,
    };

    if (opts.fileSystemManager && opts.updateScheduler) {
      const updateStatus = opts.updateScheduler.getStatus();
      const currentVersion = await opts.fileSystemManager.getCurrentVersion();

      response.content = {
        lastFetchTime: updateStatus.lastUpdateTime?.toISOString() || null,
        currentVersion: currentVersion,
        updateStatus: updateStatus.updateInProgress
          ? "in_progress"
          : updateStatus.scheduledUpdateTime
            ? "scheduled"
            : "idle",
        scheduledUpdateTime: updateStatus.scheduledUpdateTime?.toISOString() || null,
        failedUpdates: updateStatus.failedUpdates,
      };
    }

    return response;
  });

  // Web UI endpoint
  fastify.get("/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = await fastify.inject({
      method: "GET",
      url: "/api/v1/status",
    });

    const statusData = JSON.parse(status.body) as StatusResponse;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ORD Provider Server Status</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 30px;
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        .status-grid {
            display: grid;
            gap: 20px;
        }
        .status-item {
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            padding: 15px;
            background: #fafafa;
        }
        .status-label {
            font-weight: 600;
            color: #666;
            margin-bottom: 5px;
        }
        .status-value {
            font-size: 1.1em;
            color: #333;
        }
        .health-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9em;
        }
        .health-healthy {
            background: #d4edda;
            color: #155724;
        }
        .health-degraded {
            background: #fff3cd;
            color: #856404;
        }
        .health-unhealthy {
            background: #f8d7da;
            color: #721c24;
        }
        .update-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.9em;
        }
        .update-idle {
            background: #e3e3e3;
            color: #666;
        }
        .update-scheduled {
            background: #cfe2ff;
            color: #084298;
        }
        .update-in_progress {
            background: #fff3cd;
            color: #856404;
        }
        .update-button {
            margin-top: 20px;
            padding: 10px 20px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .update-button:hover:not(:disabled) {
            background: #0056b3;
        }
        .update-button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        .no-content {
            color: #666;
            font-style: italic;
        }
    </style>
    <script>
        function triggerUpdate() {
            const button = document.getElementById('updateButton');
            button.disabled = true;
            button.textContent = 'Scheduling...';

            fetch('/api/v1/webhook/github', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Manual-Trigger': 'true'
                },
                body: JSON.stringify({})
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to trigger update');
                }
                return response.json();
            })
            .then(data => {
                button.textContent = 'Update Scheduled';
                setTimeout(() => {
                    location.reload();
                }, 2000);
            })
            .catch(error => {
                console.error('Update trigger failed:', error);
                button.textContent = 'Error - Try Again';
                button.disabled = false;
            });
        }

        // Auto-refresh every 30 seconds
        setInterval(() => {
            location.reload();
        }, 30000);
    </script>
</head>
<body>
    <div class="container">
        <h1>ORD Provider Server Status</h1>

        <div class="status-grid">
            <div class="status-item">
                <div class="status-label">Server Version</div>
                <div class="status-value">${statusData.version}</div>
            </div>

            ${
              statusData.content
                ? `
                <div class="status-item">
                    <div class="status-label">Content Version</div>
                    <div class="status-value">${statusData.content.currentVersion || "No version"}</div>
                </div>

                <div class="status-item">
                    <div class="status-label">Last Update</div>
                    <div class="status-value">${
                      statusData.content.lastFetchTime
                        ? new Date(statusData.content.lastFetchTime).toLocaleString()
                        : "Never"
                    }</div>
                </div>

                <div class="status-item">
                    <div class="status-label">Update Status</div>
                    <div class="status-value">
                        <span class="update-badge update-${statusData.content.updateStatus}">
                            ${statusData.content.updateStatus.toUpperCase().replace("_", " ")}
                        </span>
                        ${
                          statusData.content.scheduledUpdateTime
                            ? `<br><small>Scheduled for: ${new Date(statusData.content.scheduledUpdateTime).toLocaleString()}</small>`
                            : ""
                        }
                    </div>
                </div>

                ${
                  statusData.content.failedUpdates > 0
                    ? `
                <div class="status-item">
                    <div class="status-label">Failed Updates</div>
                    <div class="status-value" style="color: #dc3545;">${statusData.content.failedUpdates}</div>
                </div>
                `
                    : ""
                }

                <button
                    id="updateButton"
                    class="update-button"
                    onclick="triggerUpdate()"
                    ${statusData.content.updateStatus !== "idle" ? "disabled" : ""}
                >
                    ${
                      statusData.content.updateStatus === "idle"
                        ? "Trigger Update"
                        : statusData.content.updateStatus === "scheduled"
                          ? "Update Scheduled"
                          : "Update In Progress"
                    }
                </button>
            `
                : `
                <div class="no-content">
                    Static file serving is not configured for this instance.
                </div>
            `
            }
        </div>
    </div>
</body>
</html>
    `;

    reply.type("text/html").send(html);
  });

  done();
}

export default fp(statusRouter, {
  name: "status-router",
});
