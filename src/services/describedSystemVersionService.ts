import fs from "fs";
import path from "path";
import { log } from "../util/logger.js";

export interface DescribedSystemVersion {
  version: string;
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
export function getDefaultDescribedSystemVersion(): DescribedSystemVersion {
  let version = getVersionFromPackageJson() || "1.0.0";

  const includeBuildNumber = process.env.ORD_INCLUDE_BUILD_NUMBER === "true";
  if (includeBuildNumber) {
    const startupDate = generateStartupDate();
    version = `${version}+${startupDate}`;
  }

  return { version };
}

function getVersionFromPackageJson(): string | null {
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

function generateStartupDate(): string {
  // Generate startup date in ISO format without separators (YYYYMMDDHHMI)
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, "").replace(/T/, "").substring(0, 12); // YYYYMMDDHHMI
}
