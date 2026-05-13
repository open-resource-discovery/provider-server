import path from "path";
import { ApiResource, EventResource, Package } from "@open-resource-discovery/specification";
import { isRemoteUrl, joinUrlPaths, ordIdToPathSegment } from "./pathUtils.js";
import { PATH_CONSTANTS } from "../constant.js";
import { getOrdDocumentAccessStrategies } from "./ordConfig.js";
import { OptAuthMethod } from "../model/cli.js";

function makeUrlPrefix(baseUrl: string, absoluteUrls: boolean): string {
  return absoluteUrls ? baseUrl + PATH_CONSTANTS.SERVER_PREFIX : PATH_CONSTANTS.SERVER_PREFIX;
}

export function fixResourceDefinitionUrl(url: string, ordId: string, baseUrl = "", absoluteUrls = false): string {
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
  const prefix = makeUrlPrefix(baseUrl, absoluteUrls);
  // Construct server-relative URL
  return prefix + joinUrlPaths(path.posix.resolve("/", urlWithFixedOrdId));
}

export function processResourceDefinitions<T extends EventResource | ApiResource>(
  resources: T[],
  authMethods: OptAuthMethod[],
  baseUrl = "",
  absoluteUrls = false,
): T[] {
  const accessStrategies = getOrdDocumentAccessStrategies(authMethods);

  return resources.map((resource) => ({
    ...resource,
    resourceDefinitions: (resource.resourceDefinitions || []).map((definition) => {
      return {
        ...definition,
        ...(definition.url && { url: fixResourceDefinitionUrl(definition.url, resource.ordId, baseUrl, absoluteUrls) }),
        accessStrategies,
      };
    }),
  }));
}

function isRelativeUrl(url: string): boolean {
  return !isRemoteUrl(url) && !url.startsWith("/");
}

export function processPackageLinks(packages: Package[], baseUrl = "", absoluteUrls = false): Package[] {
  const prefix = makeUrlPrefix(baseUrl, absoluteUrls);
  return packages.map((pkg) => ({
    ...pkg,
    ...(pkg.packageLinks && {
      packageLinks: pkg.packageLinks.map((link) => ({
        ...link,
        ...(link.url &&
          isRelativeUrl(link.url) && {
            url: prefix + joinUrlPaths(path.posix.resolve("/", link.url)),
          }),
      })),
    }),
    ...(pkg.files && {
      files: pkg.files.map((file) => ({
        ...file,
        ...(file.url &&
          isRelativeUrl(file.url) && {
            url: prefix + joinUrlPaths(path.posix.resolve("/", file.url)),
          }),
      })),
    }),
  }));
}
