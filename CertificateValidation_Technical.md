# Certificate Validator Technical Documentation

## Overview

The `CertificateValidator` class (`src/services/certificateValidator.ts`) implements X.509 certificate validation for mTLS authentication. It performs a three-step validation process:

1. **Time Validation** - Verifies certificate validity period
2. **Chain Building** - Constructs the certificate chain from client to root CA
3. **Signature Verification** - Validates cryptographic signatures in the chain

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              CertificateValidator                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  validateCertificate(cert)                             │
│       │                                                 │
│       ├──> 1. validateCertificateTime(cert)            │
│       │        └─> Check validity period w/ grace      │
│       │                                                 │
│       ├──> 2. validateCertificateChain(cert)           │
│       │        ├─> buildCertificateChain(cert)         │
│       │        │   └─> Traverse issuer relationships   │
│       │        └─> verifyCertificateSignature(...)     │
│       │            └─> Verify each link signature      │
│       │                                                 │
│       └──> Return CertificateValidationResult          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Validation Steps

### 1. Time Validation

**Purpose**: Ensure the certificate is currently valid (not expired, not used before valid date)

**Implementation** (`validateCertificateTime`):

```typescript
private validateCertificateTime(cert: ParsedCertificate): { isValid: boolean; error?: string }
```

**Algorithm**:

1. Extract `validFrom` and `validTo` dates from certificate
2. Get current time: `now = new Date()`
3. Apply **5-minute grace period** for clock skew:
   - `nowWithGrace = now - 5 minutes` (for "not yet valid" check)
   - `nowWithFutureGrace = now + 5 minutes` (for "expired" check)
4. Check if `nowWithGrace < validFrom` → Certificate not yet valid
5. Check if `nowWithFutureGrace > validTo` → Certificate expired
6. Return success if both checks pass

**Why Grace Period?**

- Network time synchronization may not be perfect
- Prevents false rejections due to slight time differences

**Errors**:

- `"Certificate not yet valid. Valid from: <date>"` - Certificate's validity period hasn't started
- `"Certificate expired. Valid until: <date>"` - Certificate has expired

---

### 2. Chain Building

**Purpose**: Construct the complete certificate chain from client certificate to trusted root CA

**Implementation** (`buildCertificateChain`):

```typescript
private buildCertificateChain(cert: ParsedCertificate): CertificateChain
```

**Algorithm**:

```
Start: currentCert = client certificate
Loop (max 10 iterations):

  1. Check if currentCert is self-signed (issuer == subject)
     YES → This might be a root CA
        ├─> Look up in trusted CA store by subject
        ├─> Compare fingerprints to verify match
        └─> If matched: set as chain.root, BREAK
     NO → Continue to step 2

  2. Find issuer certificate:
     ├─> Query CertificateLoader by issuer DN
     └─> If not found: Log warning, BREAK

  3. Add issuer to chain.intermediates[]

  4. Move up chain: currentCert = issuer certificate

  5. depth++, continue loop

End: Return CertificateChain
```

**Data Structure**:

```typescript
interface CertificateChain {
  clientCert: ParsedCertificate; // The original certificate
  intermediates: ParsedCertificate[]; // Intermediate CAs (ordered)
  root?: ParsedCertificate; // Root CA (if found)
}
```

**Key Points**:

- **Max Depth**: 10 levels to prevent infinite loops
- **Traversal Order**: Client → Intermediate(s) → Root
- **Self-Signed Detection**: When `issuer === subject`, certificate is self-signed (potential root)
- **Trusted Root Matching**: Uses fingerprint comparison (not just DN matching)
- **Early Termination**: Stops when root found or issuer not in CA store

**Why Fingerprint Matching?**

- Fingerprints are cryptographic hashes of the entire certificate
- Ensures the exact certificate is trusted (not just same DN)
- Prevents attacks using forged certificates with legitimate DNs

---

### 3. Signature Verification

**Purpose**: Verify that each certificate in the chain was cryptographically signed by its issuer

**Implementation** (`verifyCertificateSignature`):

```typescript
private verifyCertificateSignature(subject: X509Certificate, issuer: X509Certificate): boolean
```

**Algorithm**:

1. Extract issuer's public key
2. Use Node.js crypto API: `subject.verify(issuer.publicKey)`
3. Returns `true` if signature is valid, `false` otherwise
4. Catches and logs any exceptions during verification

**Verification Process** (`validateCertificateChain`):

```
Given chain: [Client Cert, Intermediate CA, Root CA]

Verify link 1: Client Cert signed by Intermediate CA
  └─> subject.verify(issuer.publicKey)

Verify link 2: Intermediate CA signed by Root CA
  └─> intermediate.verify(root.publicKey)

All links valid? → Chain is trusted
```

**What Signature Verification Proves**:

- The certificate was issued by the claimed CA
- The certificate has not been tampered with
- The CA authorized the certificate's contents

**Errors**:

- `"Invalid signature in certificate chain at level <N>"` - Signature verification failed at link N
- Common causes:
  - Certificate was modified after issuance
  - Wrong CA certificate in chain
  - Forged certificate

---

## Chain Validation Requirements

For a certificate to be considered valid, the chain must satisfy:

1. **Terminates at Trusted Root**:
   - Chain must end with a root CA in the trusted CA store
   - Root CA must match by fingerprint (not just DN)

2. **All Signatures Valid**:
   - Each certificate must be signed by the next certificate in chain
   - Verified using public key cryptography

3. **No Broken Links**:
   - All intermediate CAs must be found in CA store
   - Chain must be complete from client to root

---

## Certificate Matching

**Method** (`certificatesMatch`):

```typescript
private certificatesMatch(cert1: X509Certificate, cert2: X509Certificate): boolean {
  return cert1.fingerprint === cert2.fingerprint;
}
```

---

## Integration with CertificateLoader

The validator depends on `CertificateLoader` for CA certificate lookups:

```typescript
constructor(private readonly certificateLoader: CertificateLoader) {}
```

**Key Methods Used**:

- `getCertificateBySubject(dn: string)` - Find CA certificate by subject DN
  - Used during chain building to find issuers
  - Returns `X509Certificate | undefined`

**Certificate Lookup Flow**:

```
Client Cert (issuer DN: "CN=Intermediate CA,O=SAP,C=DE")
    ↓
certificateLoader.getCertificateBySubject("CN=Intermediate CA,O=SAP,C=DE")
    ↓
Returns: X509Certificate for Intermediate CA (if in store)
```

---

## Complete Validation Flow Example

**Input**: Client certificate from mTLS request

```
Step 1: Time Validation
├─> validFrom: 2024-01-01T00:00:00Z
├─> validTo: 2025-12-31T23:59:59Z
├─> now: 2024-06-15T10:30:00Z
└─> ✓ Within validity period (with grace)

Step 2: Build Chain
├─> Client Cert: CN=my-app,O=MyCompany,C=US
│   Issuer: CN=Intermediate CA,O=MyCompany,C=US
│
├─> Lookup issuer in CA store → Found
├─> Add to intermediates[]
│
├─> Intermediate CA: CN=Intermediate CA,O=MyCompany,C=US
│   Issuer: CN=Root CA,O=MyCompany,C=US
│
├─> Lookup issuer in CA store → Found
├─> Check if self-signed: issuer == subject → YES
├─> Match fingerprint with trusted root → MATCH
└─> Set as chain.root

Result: Chain = [Client Cert] → [Intermediate CA] → [Root CA] ✓

Step 3: Verify Signatures
├─> Verify: Client Cert signed by Intermediate CA
│   └─> clientCert.verify(intermediateCa.publicKey) → true ✓
│
└─> Verify: Intermediate CA signed by Root CA
    └─> intermediateCa.verify(rootCa.publicKey) → true ✓

Final Result: ✓ Certificate Valid
```
