/**
 * Error raised while loading secrets from the SAP BTP Credential Store.
 * The message is meant to be shown to the operator as is, so it must be human readable and must never contain secret values.
 */
export class CredentialStoreError extends Error {
  public name = "CredentialStoreError";
}
