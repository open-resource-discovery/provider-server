import {
  normalizePath,
  joinUrlPaths,
  joinFilePaths,
  ordIdToPathSegment,
  pathSegmentToOrdId,
  isRemoteUrl,
  getFileName,
  getDirName,
} from "../pathUtils.js";

describe("Path Utilities", () => {
  describe("normalizePath", () => {
    it("should convert backslashes to forward slashes", () => {
      expect(normalizePath("path\\to\\file")).toBe("path/to/file");
    });

    it("should not modify paths with forward slashes", () => {
      expect(normalizePath("path/to/file")).toBe("path/to/file");
    });

    it("should handle mixed slashes", () => {
      expect(normalizePath("path/to\\file")).toBe("path/to/file");
    });
  });

  describe("joinUrlPaths", () => {
    it("should join path segments with forward slashes", () => {
      expect(joinUrlPaths("path", "to", "file")).toBe("/path/to/file");
    });

    it("should remove leading and trailing slashes from segments", () => {
      expect(joinUrlPaths("/path/", "/to/", "/file/")).toBe("/path/to/file");
    });

    it("should handle empty segments", () => {
      expect(joinUrlPaths("path", "", "file")).toBe("/path/file");
    });

    it("should handle segments with special characters", () => {
      expect(joinUrlPaths("path", "to:resource", "file")).toBe("/path/to:resource/file");
    });
  });

  describe("joinFilePaths", () => {
    it("should join path segments with forward slashes", () => {
      expect(joinFilePaths("path", "to", "file")).toBe("path/to/file");
    });

    it("should handle absolute paths", () => {
      expect(joinFilePaths("/path", "to", "file")).toBe("/path/to/file");
    });

    it("should handle relative paths", () => {
      expect(joinFilePaths("path", "..", "file")).toBe("file");
    });
  });

  describe("ordIdToPathSegment", () => {
    it("should replace colons with underscores", () => {
      expect(ordIdToPathSegment("sap.xref:apiResource:astronomy:v1")).toBe("sap.xref_apiResource_astronomy_v1");
    });

    it("should not modify strings without colons", () => {
      expect(ordIdToPathSegment("resource")).toBe("resource");
    });
  });

  describe("pathSegmentToOrdId", () => {
    it("should replace underscores with colons", () => {
      expect(pathSegmentToOrdId("sap.xref_apiResource_astronomy_v1")).toBe("sap.xref:apiResource:astronomy:v1");
    });

    it("should not modify strings without underscores", () => {
      expect(pathSegmentToOrdId("resource")).toBe("resource");
    });
  });

  describe("isRemoteUrl", () => {
    it("should return true for http URLs", () => {
      expect(isRemoteUrl("http://example.com")).toBe(true);
    });

    it("should return true for https URLs", () => {
      expect(isRemoteUrl("https://example.com")).toBe(true);
    });

    it("should return false for relative paths", () => {
      expect(isRemoteUrl("/path/to/resource")).toBe(false);
    });

    it("should return false for absolute paths", () => {
      expect(isRemoteUrl("C:/path/to/resource")).toBe(false);
    });
  });

  describe("getFileName", () => {
    it("should extract the file name without extension", () => {
      expect(getFileName("/path/to/file.txt")).toBe("file");
    });

    it("should handle paths without extensions", () => {
      expect(getFileName("/path/to/file")).toBe("file");
    });

    it("should handle paths with multiple dots", () => {
      expect(getFileName("/path/to/file.name.txt")).toBe("file.name");
    });
  });

  describe("getDirName", () => {
    it("should extract the directory name", () => {
      expect(getDirName("/path/to/file.txt")).toBe("/path/to");
    });

    it("should handle root directories", () => {
      expect(getDirName("/file.txt")).toBe("/");
    });

    it("should handle relative paths", () => {
      expect(getDirName("path/to/file.txt")).toBe("path/to");
    });
  });
});
