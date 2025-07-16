import { log } from "../util/logger.js";

interface VersionInfo {
  current: string;
  latest: string;
  isOutdated: boolean;
  lastChecked: Date;
}

export class VersionService {
  private static instance: VersionService;
  private latestVersionCache: { version: string; timestamp: Date } | null = null;
  private readonly cacheTimeout = 60 * 60 * 1000;
  private readonly registryUrl = "https://ghcr.io";
  private readonly imageName = "open-resource-discovery/provider-server";

  private constructor() {}

  public static getInstance(): VersionService {
    if (!VersionService.instance) {
      VersionService.instance = new VersionService();
    }
    return VersionService.instance;
  }

  public async getVersionInfo(currentVersion: string): Promise<VersionInfo> {
    try {
      const latest = await this.getLatestVersion();
      const isOutdated = this.compareVersions(currentVersion, latest) < 0;

      return {
        current: currentVersion,
        latest,
        isOutdated,
        lastChecked: new Date(),
      };
    } catch (error) {
      log.warn("Failed to fetch latest version from GHCR:", error);
      return {
        current: currentVersion,
        latest: currentVersion,
        isOutdated: false,
        lastChecked: new Date(),
      };
    }
  }

  private async getLatestVersion(): Promise<string> {
    if (this.latestVersionCache) {
      const cacheAge = Date.now() - this.latestVersionCache.timestamp.getTime();
      if (cacheAge < this.cacheTimeout) {
        return this.latestVersionCache.version;
      }
    }

    // Fetch from GHCR
    const tags = await this.fetchTags();
    const latestVersion = this.findLatestVersion(tags);

    this.latestVersionCache = {
      version: latestVersion,
      timestamp: new Date(),
    };

    return latestVersion;
  }

  private async fetchTags(): Promise<string[]> {
    try {
      const token = await this.getAuthToken();

      const response = await fetch(`${this.registryUrl}/v2/${this.imageName}/tags/list`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { tags?: string[] };
      return data.tags || [];
    } catch (error) {
      log.error("Error fetching tags from GHCR:", error);
      throw error;
    }
  }

  private async getAuthToken(): Promise<string> {
    try {
      const response = await fetch(`${this.registryUrl}/token?scope=repository:${this.imageName}:pull&service=ghcr.io`);

      if (!response.ok) {
        throw new Error(`Failed to get auth token: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { token?: string };
      return data.token || "";
    } catch (error) {
      log.error("Error getting auth token from GHCR:", error);
      throw error;
    }
  }

  private findLatestVersion(tags: string[]): string {
    const versionTags = tags.filter((tag) => {
      return /^v?\d+\.\d+\.\d+$/.test(tag);
    });

    if (versionTags.length === 0) {
      return tags.includes("latest") ? "latest" : "0.0.0";
    }

    versionTags.sort((a, b) => this.compareVersions(b, a));
    return versionTags[0];
  }

  private compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/^v/, "");
    const clean2 = v2.replace(/^v/, "");

    if (clean1 === "latest") return -1;
    if (clean2 === "latest") return 1;
    if (clean1 === clean2) return 0;

    // Since we're only dealing with stable versions now (x.y.z), split by dots
    const parts1 = clean1.split(".").map(Number);
    const parts2 = clean2.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 !== p2) {
        return p1 - p2;
      }
    }

    // Since we're filtering out pre-release versions, we should only have 3 parts
    return 0;
  }
}
