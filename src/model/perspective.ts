import { ORDDocument } from "@open-resource-discovery/specification";

/**
 * Perspective type as defined in ORD specification v1.12.0
 */
export type Perspective = "system-version" | "system-instance" | "system-independent";

/**
 * Default perspective value according to the requirement:
 * "If no `perspective` property is defined in the ORD document, use `system-version` as default"
 * Note: This differs from the ORD spec default which is `system-instance`
 */
export const DEFAULT_PERSPECTIVE: Perspective = "system-version";

/**
 * Type guard to check if a document has perspective property defined
 */
export function hasPerspecive(doc: ORDDocument): boolean {
  return "perspective" in doc && doc.perspective !== undefined;
}

/**
 * Get the perspective from a document, defaulting to system-version
 * Note: This uses our custom default instead of the spec's default
 */
export function getDocumentPerspective(doc: ORDDocument): Perspective {
  return doc.perspective || DEFAULT_PERSPECTIVE;
}
