import { OrdDocument } from "@open-resource-discovery/specification";

export const validateOrdDocument = (doc: OrdDocument): void => {
  // TODO: This is very primitive - enhance validation in the future
  if (!doc.openResourceDiscovery) throw new Error("document is invalid!");
};
