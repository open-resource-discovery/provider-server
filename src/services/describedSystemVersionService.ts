import fs from "fs";
import path from "path";
import { log } from "../util/logger.js";

export interface DescribedSystemVersion {
  version: string;
}

export class DescribedSystemVersionService {
  private static instance: DescribedSystemVersionService;
  private readonly startupDate: string;
  private readonly includeBuildNumber: boolean;

  private constructor() {
    // Generate startup date in ISO format without separators (YYYYMMDDHHMI)
    const now = new Date();
    this.startupDate = now.toISOString().replace(/[-:]/g, "").replace(/T/, "").substring(0, 12); // YYYYMMDDHHMI

    // Check environment variable for build number inclusion
    this.includeBuildNumber = process.env.ORD_INCLUDE_BUILD_NUMBER === "true";
  }

  public static getInstance(): DescribedSystemVersionService {
    if (!DescribedSystemVersionService.instance) {
      DescribedSystemVersionService.instance = new DescribedSystemVersionService();
    }
    return DescribedSystemVersionService.instance;
  }

  /**
   * Gets the default described system version.
   * Priority:
   * 1. Version from package.json in current working directory
   * 2. Fallback to "1.0.0"
   *
   * If ORD_INCLUDE_BUILD_NUMBER environment variable is "true",
   * appends startup date as build number (e.g., "1.0.0+202509121027")
   */
  public getDefaultDescribedSystemVersion(): DescribedSystemVersion {
    let version = this.getVersionFromPackageJson() || "1.0.0";

    if (this.includeBuildNumber) {
      version = `${version}+${this.startupDate}`;
    }

    return { version };
  }

  private getVersionFromPackageJson(): string | null {
    try {
      const packageJsonPath = path.join(process.cwd(), "package.json");

      if (!fs.existsSync(packageJsonPath)) {
        log.debug("No package.json found in current working directory");
        return null;
      }

      const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageJsonContent);

      if (packageJson.version && typeof packageJson.version === "string") {
        log.debug(`Found version in package.json: ${packageJson.version}`);
        return packageJson.version;
      }

      log.debug("No version field found in package.json");
      return null;
    } catch (error) {
      log.warn(`Error reading package.json: ${error}`);
      return null;
    }
  }
}
