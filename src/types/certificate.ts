import { X509Certificate } from "crypto";

export interface ParsedCertificate {
  raw: string;
  x509: X509Certificate;
  subject: CertificateSubject;
  issuer: CertificateSubject;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  fingerprint: string;
}

export interface CertificateSubject {
  CN?: string;
  O?: string;
  OU?: string;
  C?: string;
  L?: string;
  ST?: string;
  DN: string;
}

export interface CertificateValidationResult {
  isValid: boolean;
  error?: string;
  details?: {
    chainValid?: boolean;
    timeValid?: boolean;
    revocationValid?: boolean;
    issuerValid?: boolean;
    subjectValid?: boolean;
  };
}

export interface CaCertificate {
  name: string;
  url: string;
  certificate?: X509Certificate;
}

export interface CertificateChain {
  clientCert: ParsedCertificate;
  intermediates: ParsedCertificate[];
  root?: ParsedCertificate;
}
