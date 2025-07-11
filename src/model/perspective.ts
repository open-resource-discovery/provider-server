import { ORDDocument } from "@open-resource-discovery/specification";

export type Perspective = "system-version" | "system-instance" | "system-independent";

export const DEFAULT_PERSPECTIVE: Perspective = "system-version";

/**
 * Type guard to check if a document has perspective property defined
 */
export function hasPerspecive(doc: ORDDocument): boolean {
  return "perspective" in doc && doc.perspective !== undefined;
}

/**
 * Get the perspective from a document, defaulting to system-instance
 * Note: This uses our custom default instead of the spec's default
 */
export function getDocumentPerspective(doc: ORDDocument): Perspective {
  return doc.perspective || DEFAULT_PERSPECTIVE;
}
