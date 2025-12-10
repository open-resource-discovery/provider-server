import { WILDCARD_DN } from "../../constant.js";
import { tokenizeDn, dnTokensMatch, isWildcardDn } from "../certificateHelpers.js";

describe("certificateHelpers", () => {
  describe("tokenizeDn", () => {
    it("should tokenize comma-separated DN", () => {
      const dn = "CN=test,O=ACME,C=DE";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=test", "O=ACME", "C=DE"]);
    });

    it("should tokenize slash-separated DN", () => {
      const dn = "/CN=test/O=ACME/C=DE";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=test", "O=ACME", "C=DE"]);
    });

    it("should handle DN with leading slash", () => {
      const dn = "/C=DE/O=ACME-AG/CN=C5998933a";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["C=DE", "O=ACME-AG", "CN=C5998933a"]);
    });

    it("should trim whitespace from tokens", () => {
      const dn = "CN=test, O=ACME , C=DE";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=test", "O=ACME", "C=DE"]);
    });

    it("should filter out empty tokens", () => {
      const dn = "CN=test,,O=ACME,C=DE";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=test", "O=ACME", "C=DE"]);
    });

    it("should handle single token DN", () => {
      const dn = "CN=test";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=test"]);
    });

    it("should handle empty DN", () => {
      const dn = "";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual([]);
    });

    it("should handle complex DN with multiple attributes", () => {
      const dn = "CN=my-service,OU=Development,O=ACME SE,L=Walldorf,ST=BW,C=DE";
      const tokens = tokenizeDn(dn);
      expect(tokens).toEqual(["CN=my-service", "OU=Development", "O=ACME SE", "L=Walldorf", "ST=BW", "C=DE"]);
    });
  });

  describe("dnTokensMatch", () => {
    it("should match identical token arrays", () => {
      const tokens1 = ["CN=test", "O=ACME", "C=DE"];
      const tokens2 = ["CN=test", "O=ACME", "C=DE"];
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });

    it("should match tokens in different order", () => {
      const tokens1 = ["CN=test", "O=ACME", "C=DE"];
      const tokens2 = ["C=DE", "O=ACME", "CN=test"];
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });

    it("should not match different tokens", () => {
      const tokens1 = ["CN=test", "O=ACME", "C=DE"];
      const tokens2 = ["CN=other", "O=ACME", "C=DE"];
      expect(dnTokensMatch(tokens1, tokens2)).toBe(false);
    });

    it("should not match arrays of different length", () => {
      const tokens1 = ["CN=test", "O=ACME", "C=DE"];
      const tokens2 = ["CN=test", "O=ACME"];
      expect(dnTokensMatch(tokens1, tokens2)).toBe(false);
    });

    it("should match empty arrays", () => {
      expect(dnTokensMatch([], [])).toBe(true);
    });

    it("should match single token arrays", () => {
      const tokens1 = ["CN=test"];
      const tokens2 = ["CN=test"];
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });

    it("should not modify original arrays", () => {
      const tokens1 = ["C=DE", "O=ACME", "CN=test"];
      const tokens2 = ["CN=test", "O=ACME", "C=DE"];
      dnTokensMatch(tokens1, tokens2);
      expect(tokens1).toEqual(["C=DE", "O=ACME", "CN=test"]);
      expect(tokens2).toEqual(["CN=test", "O=ACME", "C=DE"]);
    });
  });

  describe("isWildcardDn", () => {
    it("should return true for wildcard '*'", () => {
      expect(isWildcardDn("*")).toBe(true);
      expect(isWildcardDn(WILDCARD_DN)).toBe(true);
    });

    it("should return true for '*' with surrounding whitespace", () => {
      expect(isWildcardDn(" * ")).toBe(true);
      expect(isWildcardDn("  *")).toBe(true);
      expect(isWildcardDn("*  ")).toBe(true);
    });

    it("should return false for regular DNs", () => {
      expect(isWildcardDn("CN=test,O=ACME,C=DE")).toBe(false);
      expect(isWildcardDn("/C=DE/O=ACME/CN=test")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isWildcardDn("")).toBe(false);
    });

    it("should return false for whitespace-only string", () => {
      expect(isWildcardDn("   ")).toBe(false);
    });

    it("should return false for strings containing '*' but not being the wildcard", () => {
      expect(isWildcardDn("CN=*,O=ACME")).toBe(false);
      expect(isWildcardDn("**")).toBe(false);
      expect(isWildcardDn("* *")).toBe(false);
    });
  });

  describe("integration", () => {
    it("should match same DN in different formats", () => {
      const dn1 = "CN=test,O=ACME,C=DE";
      const dn2 = "/C=DE/O=ACME/CN=test";
      const tokens1 = tokenizeDn(dn1);
      const tokens2 = tokenizeDn(dn2);
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });

    it("should handle real-world DNs", () => {
      const dn1 = "/C=DE/O=ACME-AG/CN=C5998933a";
      const dn2 = "CN=C5998933a,O=ACME-AG,C=DE";
      const tokens1 = tokenizeDn(dn1);
      const tokens2 = tokenizeDn(dn2);
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });

    it("should match issuer DNs with different orders", () => {
      const issuer1 = "/C=DE/L=Walldorf/O=ACME SE/CN=ACME SSO CA G2";
      const issuer2 = "CN=ACME SSO CA G2,O=ACME SE,L=Walldorf,C=DE";
      const tokens1 = tokenizeDn(issuer1);
      const tokens2 = tokenizeDn(issuer2);
      expect(dnTokensMatch(tokens1, tokens2)).toBe(true);
    });
  });
});
