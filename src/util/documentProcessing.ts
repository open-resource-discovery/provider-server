import path from "path";
import { ApiResource, EventResource, Package } from "@open-resource-discovery/specification";
import { isRemoteUrl, joinUrlPaths, ordIdToPathSegment } from "./pathUtils.js";
import { PATH_CONSTANTS } from "../constant.js";
import { getOrdDocumentAccessStrategies } from "./ordConfig.js";
import { OptAuthMethod } from "../model/cli.js";

export function fixResourceDefinitionUrl(url: string, ordId: string): string {
  const escapedOrdId = ordIdToPathSegment(ordId);
  const pathParts = url.split("/");
  const ordIdIdx = pathParts.findIndex((part) => escapedOrdId === part);

  if (ordIdIdx > -1) {
    pathParts[ordIdIdx] = ordId;
  }

  const urlWithFixedOrdId = pathParts.join("/");

  if (isRemoteUrl(url)) {
    return urlWithFixedOrdId;
  }
  // Construct server-relative URL
  return joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, path.posix.resolve("/", urlWithFixedOrdId));
}

export function processResourceDefinitions<T extends EventResource | ApiResource>(
  resources: T[],
  authMethods: OptAuthMethod[],
): T[] {
  const accessStrategies = getOrdDocumentAccessStrategies(authMethods);

  return resources.map((resource) => ({
    ...resource,
    resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => {
      return {
        ...definition,
        ...(definition.url && { url: fixResourceDefinitionUrl(definition.url, resource.ordId) }),
        accessStrategies,
      };
    }),
  }));
}

function isRelativeUrl(url: string): boolean {
  return !isRemoteUrl(url) && !url.startsWith("/");
}

export function processPackageLinks(packages: Package[]): Package[] {
  return packages.map((pkg) => ({
    ...pkg,
    ...(pkg.packageLinks && {
      packageLinks: pkg.packageLinks.map((link) => ({
        ...link,
        ...(link.url &&
          isRelativeUrl(link.url) && {
            url: joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, path.posix.resolve("/", link.url)),
          }),
      })),
    }),
    ...(pkg.files && {
      files: pkg.files.map((file) => ({
        ...file,
        ...(file.url &&
          isRelativeUrl(file.url) && {
            url: joinUrlPaths(PATH_CONSTANTS.SERVER_PREFIX, path.posix.resolve("/", file.url)),
          }),
      })),
    }),
  }));
}
