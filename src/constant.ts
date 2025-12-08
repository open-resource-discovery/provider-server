// URL path constants
export const PATH_CONSTANTS = {
  // Base paths
  ORD_URL_PATH: "ord",
  ORD_VERSION: "v1",
  WELL_KNOWN_ENDPOINT: "/.well-known/open-resource-discovery",
  STATUS_ENDPOINT: "/api/v1/status",
  WEBHOOK_ENDPOINT: "/api/v1/webhook/github",

  // Derived paths
  SERVER_PREFIX: `/ord/v1`,
  DOCUMENTS_URL_PATH: `/ord/v1/documents`,

  // Directory constants
  DOCUMENTS_SUBDIRECTORY: process.env.ORD_DOCUMENTS_SUBDIRECTORY || "documents",
  GITHUB_DEFAULT_ROOT: "data",
  GITHUB_DOCUMENTS_PATH: "data/documents",
};

export const CERT_ISSUER_DN_HEADER = "x-ssl-client-issuer-dn";
export const CERT_SUBJECT_DN_HEADER = "x-ssl-client-subject-dn";
export const CERT_ROOT_CA_DN_HEADER = "x-ssl-client-root-ca-dn";

// XFCC (X-Forwarded-Client-Cert) headers for proxy-verified mTLS
export const CERT_XFCC_HEADER = "x-forwarded-client-cert";
export const CERT_CLIENT_HEADER = "x-ssl-client";
export const CERT_CLIENT_VERIFY_HEADER = "x-ssl-client-verify";

export const WILDCARD_DN = "*";
