import {
  OptSourceType,
  parseSourceType,
  OptAuthMethod,
  OrdAccessStrategy,
  mapOptAuthToOrdAccessStrategy,
  parseAuthMethods,
} from "../cli.js";

describe("cli", () => {
  describe("parseSourceType", () => {
    it("should parse valid local source type", () => {
      expect(parseSourceType("local")).toBe(OptSourceType.Local);
    });

    it("should parse valid github source type", () => {
      expect(parseSourceType("github")).toBe(OptSourceType.Github);
    });

    it("should default to local for invalid source type", () => {
      expect(parseSourceType("invalid")).toBe(OptSourceType.Local);
      expect(parseSourceType("")).toBe(OptSourceType.Local);
      expect(parseSourceType("random")).toBe(OptSourceType.Local);
    });
  });

  describe("mapOptAuthToOrdAccessStrategy", () => {
    it("should map open auth method", () => {
      expect(mapOptAuthToOrdAccessStrategy(OptAuthMethod.Open)).toBe(OrdAccessStrategy.Open);
    });

    it("should map basic auth method", () => {
      expect(mapOptAuthToOrdAccessStrategy(OptAuthMethod.Basic)).toBe(OrdAccessStrategy.Basic);
    });
  });

  describe("parseAuthMethods", () => {
    it("should return default Open auth for empty string", () => {
      expect(parseAuthMethods("")).toEqual([OptAuthMethod.Open]);
    });

    it("should parse single auth method", () => {
      expect(parseAuthMethods("basic")).toEqual([OptAuthMethod.Basic]);
      expect(parseAuthMethods("open")).toEqual([OptAuthMethod.Open]);
    });

    it("should parse multiple auth methods", () => {
      expect(parseAuthMethods("open,basic")).toEqual([OptAuthMethod.Open, OptAuthMethod.Basic]);
      expect(parseAuthMethods("basic,open")).toEqual([OptAuthMethod.Basic, OptAuthMethod.Open]);
    });

    it("should handle whitespace", () => {
      expect(parseAuthMethods(" open , basic ")).toEqual([OptAuthMethod.Open, OptAuthMethod.Basic]);
      expect(parseAuthMethods("  basic  ")).toEqual([OptAuthMethod.Basic]);
    });

    it("should handle case insensitivity", () => {
      expect(parseAuthMethods("OPEN")).toEqual([OptAuthMethod.Open]);
      expect(parseAuthMethods("Basic")).toEqual([OptAuthMethod.Basic]);
      expect(parseAuthMethods("OPEN,BASIC")).toEqual([OptAuthMethod.Open, OptAuthMethod.Basic]);
    });

    it("should filter out invalid methods", () => {
      expect(parseAuthMethods("open,invalid,basic")).toEqual([OptAuthMethod.Open, OptAuthMethod.Basic]);
      expect(parseAuthMethods("invalid")).toEqual([]);
      expect(parseAuthMethods("unknown,fake")).toEqual([]);
    });

    it("should handle mixed valid and invalid methods", () => {
      expect(parseAuthMethods("open,invalid,basic,another")).toEqual([OptAuthMethod.Open, OptAuthMethod.Basic]);
    });
  });
});
