import { X509Certificate } from "crypto";
import { readFile } from "fs/promises";
import { CaCertificate } from "../types/certificate.js";
import { log } from "../util/logger.js";

interface CaChainDefinition {
  name: string;
  url: string;
}

export class CertificateLoader {
  private readonly certificates: Map<string, X509Certificate> = new Map();
  private readonly certificatesBySubject: Map<string, X509Certificate> = new Map();
  private initialized = false;
  private caDefinitions: CaChainDefinition[] = [];

  public constructor(private readonly caChainFilePath?: string) {}

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load CA definitions from file
    await this.loadCaDefinitions();

    log.info(`Initializing certificate loader with ${this.caDefinitions.length} CA definitions...`);

    const results = await Promise.allSettled(this.caDefinitions.map((ca) => this.loadCertificate(ca)));

    const loaded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    log.info(`Loaded ${loaded} CA certificates, ${failed} failed`);

    if (loaded === 0) {
      throw new Error("Failed to load any CA certificates");
    }

    this.initialized = true;
  }

  private async loadCaDefinitions(): Promise<void> {
    if (!this.caChainFilePath) {
      throw new Error("CA chain configuration is required but was not provided");
    }

    try {
      let jsonContent: string;
      const trimmedInput = this.caChainFilePath.trim();

      // Check if input is inline JSON (starts with [ or {)
      if (trimmedInput.startsWith("[") || trimmedInput.startsWith("{")) {
        log.info(`Loading CA chain definitions from inline JSON`);
        jsonContent = trimmedInput;
      } else {
        // Treat as file path
        log.info(`Loading CA chain definitions from file: ${this.caChainFilePath}`);
        jsonContent = await readFile(this.caChainFilePath, "utf-8");
      }

      const parsed = JSON.parse(jsonContent);

      if (!Array.isArray(parsed)) {
        throw new Error("CA chain configuration must be a JSON array");
      }

      // Validate each entry
      for (const entry of parsed) {
        if (!entry.name || typeof entry.name !== "string") {
          throw new Error(`Invalid CA definition: missing or invalid 'name' field`);
        }
        if (!entry.url || typeof entry.url !== "string") {
          throw new Error(`Invalid CA definition for '${entry.name}': missing or invalid 'url' field`);
        }
      }

      this.caDefinitions = parsed;
      log.info(`Successfully loaded ${this.caDefinitions.length} CA definitions`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to load CA chain configuration: ${message}`);
      throw new Error(`Failed to load CA chain configuration: ${message}`);
    }
  }

  private async loadCertificate(ca: Omit<CaCertificate, "certificate">): Promise<void> {
    try {
      const certData = await this.fetchWithRetry(ca.url);
      const certificate = this.parseCertificate(certData);

      this.certificates.set(ca.name, certificate);
      this.certificatesBySubject.set(certificate.subject, certificate);

      log.debug(`Loaded certificate: ${ca.name} (${certificate.subject})`);
    } catch (error) {
      log.error(`Failed to load certificate ${ca.name}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async fetchWithRetry(url: string, retries = 3): Promise<string> {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/x-x509-ca-cert,application/pkix-cert" },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return this.convertToPEM(buffer);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (i < retries - 1) {
          const delay = Math.pow(2, i) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Failed to fetch certificate");
  }

  private convertToPEM(buffer: ArrayBuffer): string {
    const base64 = Buffer.from(buffer).toString("base64");
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
  }

  private parseCertificate(pemData: string): X509Certificate {
    try {
      return new X509Certificate(pemData);
    } catch {
      // Try DER format if PEM fails
      const derBuffer = Buffer.from(pemData.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
      return new X509Certificate(derBuffer);
    }
  }

  public getCertificateBySubject(subject: string): X509Certificate | undefined {
    return this.certificatesBySubject.get(subject);
  }

  public getCertificateByName(name: string): X509Certificate | undefined {
    return this.certificates.get(name);
  }

  public getAllCertificates(): X509Certificate[] {
    return Array.from(this.certificates.values());
  }

  public getCACertificateDefinitions(): CaChainDefinition[] {
    return this.caDefinitions;
  }
}

let globalLoader: CertificateLoader | null = null;

export async function getCertificateLoader(caChainFilePath?: string): Promise<CertificateLoader> {
  if (!globalLoader) {
    globalLoader = new CertificateLoader(caChainFilePath);
    await globalLoader.initialize();
  }
  return globalLoader;
}
