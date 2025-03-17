export const ORD_URL_PATH = "ord";
export const ORD_VERSION = "v1";
export const WELL_KNOWN_ENDPOINT = `/.well-known/open-resource-discovery`;
export const ORD_SERVER_PREFIX_PATH = `/${ORD_URL_PATH}/${ORD_VERSION}`;
export const ORD_DOCUMENTS_URL_PATH = `${ORD_SERVER_PREFIX_PATH}/documents`;
export const ORD_DOCUMENTS_SUB_DIRECTORY = process.env.ORD_DOCUMENTS_SUBDIRECTORY || "documents";
export const ORD_DOCUMENTS_GITHUB_DIRECTORY = "data/documents";
export const ORD_GITHUB_DEFAULT_ROOT_DIRECTORY = "data";
