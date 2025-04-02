import { getOrdDocumentPath, getEncodedFilePath } from "../documentUrl.js";
import { PATH_CONSTANTS } from "../../constant.js";

describe("Document URL Utilities", () => {
  describe("getEncodedFilePath", () => {
    it("should return the correct encoded file path for the provided example", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/document-1.json";

      const result = getEncodedFilePath(rootPath, file);

      expect(result).toBe("ord_documents/document-1");
    });

    it("should handle filenames with special characters", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/document with spaces & special chars.json";

      const result = getEncodedFilePath(rootPath, file);

      expect(result).toBe("ord_documents/document%20with%20spaces%20%26%20special%20chars");
    });

    it("should handle nested directories", () => {
      const rootPath = "environments/eu10/stage-canary";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/nested/document-1.json";

      const result = getEncodedFilePath(rootPath, file);

      expect(result).toBe("defaults/ord_documents/nested/document-1");
    });

    it("should handle files at the root level", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/document-1.json";

      const result = getEncodedFilePath(rootPath, file);

      expect(result).toBe("document-1");
    });

    it("should handle examples directory structure", () => {
      const rootPath = "examples/";
      const file = "examples/documents/document-1.json";

      const result = getEncodedFilePath(rootPath, file);

      expect(result).toBe("documents/document-1");
    });
  });

  describe("getOrdDocumentPath", () => {
    it("should return the correct document path for the provided example", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/document-1.json";

      const result = getOrdDocumentPath(rootPath, file);

      expect(result).toBe(`${PATH_CONSTANTS.SERVER_PREFIX}/ord_documents/document-1`);
    });

    it("should correctly prepend the server prefix path", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/document-1.json";

      const result = getOrdDocumentPath(rootPath, file);

      expect(result).toBe(`${PATH_CONSTANTS.SERVER_PREFIX}/document-1`);
      expect(result).toContain("/ord/v1");
    });

    it("should handle filenames with special characters", () => {
      const rootPath = "environments/eu10/stage-canary/defaults";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/document with spaces & special chars.json";

      const result = getOrdDocumentPath(rootPath, file);

      expect(result).toBe(
        `${PATH_CONSTANTS.SERVER_PREFIX}/ord_documents/document%20with%20spaces%20%26%20special%20chars`,
      );
    });

    it("should handle nested directories", () => {
      const rootPath = "environments/eu10/stage-canary";
      const file = "environments/eu10/stage-canary/defaults/ord_documents/nested/document-1.json";

      const result = getOrdDocumentPath(rootPath, file);

      expect(result).toBe(`${PATH_CONSTANTS.SERVER_PREFIX}/defaults/ord_documents/nested/document-1`);
    });

    it("should handle examples directory structure", () => {
      const rootPath = "examples/";
      const file = "examples/documents/document-1.json";

      const result = getOrdDocumentPath(rootPath, file);

      expect(result).toBe(`${PATH_CONSTANTS.SERVER_PREFIX}/documents/document-1`);
    });
  });
});
