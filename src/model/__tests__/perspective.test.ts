import { getDocumentPerspective, hasPerspecive, DEFAULT_PERSPECTIVE } from "../perspective.js";
import { OrdDocument } from "@open-resource-discovery/specification";

describe("Perspective Model", () => {
  describe("DEFAULT_PERSPECTIVE", () => {
    it("should be 'system-instance'", () => {
      expect(DEFAULT_PERSPECTIVE).toBe("system-instance");
    });
  });

  describe("hasPerspecive", () => {
    it("should return true when document has perspective property", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
        perspective: "system-instance",
      };

      expect(hasPerspecive(doc)).toBe(true);
    });

    it("should return false when document does not have perspective property", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
      };

      expect(hasPerspecive(doc)).toBe(false);
    });

    it("should return false when perspective is undefined", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
        perspective: undefined,
      };

      expect(hasPerspecive(doc)).toBe(false);
    });
  });

  describe("getDocumentPerspective", () => {
    it("should return the document's perspective when set", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
        perspective: "system-instance",
      };

      expect(getDocumentPerspective(doc)).toBe("system-instance");
    });

    it("should return 'system-instance' when perspective is not set", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
      };

      expect(getDocumentPerspective(doc)).toBe("system-instance");
    });

    it("should return 'system-instance' when perspective is undefined", () => {
      const doc: OrdDocument = {
        openResourceDiscovery: "1.12",
        describedSystemInstance: {
          baseUrl: "http://example.com",
        },
        perspective: undefined,
      };

      expect(getDocumentPerspective(doc)).toBe("system-instance");
    });

    it("should handle all valid perspective values", () => {
      const perspectives = ["system-version", "system-instance", "system-independent"] as const;

      perspectives.forEach((perspective) => {
        const doc: OrdDocument = {
          openResourceDiscovery: "1.12",
          describedSystemInstance: {
            baseUrl: "http://example.com",
          },
          perspective,
        };

        expect(getDocumentPerspective(doc)).toBe(perspective);
      });
    });
  });
});
