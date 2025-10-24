import { validateGitContent } from "../validateGit.js";
import { validateLocalDirectory } from "../validateOptions.js";

jest.mock("../validateOptions.js");

describe("validateGit", () => {
  describe("validateGitContent", () => {
    it("should call validateLocalDirectory with correct parameters", () => {
      const mockValidateLocalDirectory = validateLocalDirectory as jest.MockedFunction<typeof validateLocalDirectory>;
      mockValidateLocalDirectory.mockImplementation(() => {});

      validateGitContent("/test/dir", "documents");

      expect(mockValidateLocalDirectory).toHaveBeenCalledWith("/test/dir", "documents");
    });

    it("should pass through validation errors", () => {
      const mockValidateLocalDirectory = validateLocalDirectory as jest.MockedFunction<typeof validateLocalDirectory>;
      const error = new Error("Validation failed");
      mockValidateLocalDirectory.mockImplementation(() => {
        throw error;
      });

      expect(() => validateGitContent("/test/dir", "documents")).toThrow("Validation failed");
    });

    it("should not throw when validation passes", () => {
      const mockValidateLocalDirectory = validateLocalDirectory as jest.MockedFunction<typeof validateLocalDirectory>;
      mockValidateLocalDirectory.mockImplementation(() => {});

      expect(() => validateGitContent("/test/dir", "documents")).not.toThrow();
    });
  });
});
