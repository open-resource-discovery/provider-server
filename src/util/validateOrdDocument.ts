import { ORDDocument } from "@sap/open-resource-discovery";

export const validateOrdDocument = (doc: ORDDocument): void => {
  // TODO: This is very primitive - enhance validation in the future
  if (!doc.openResourceDiscovery) throw new Error("document is invalid!");
};
