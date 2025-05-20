#!/bin/bash
# Script to generate test certificates for mTLS

CERTS_DIR="./certs_test" # Use a distinct directory for test certs
mkdir -p "$CERTS_DIR"

echo "Generating Test CA..."
openssl genrsa -out "$CERTS_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$CERTS_DIR/ca.key" -sha256 -days 1024 -out "$CERTS_DIR/ca.pem" -subj "/CN=Test ORD CA"

echo "Generating Server Certificate..."
openssl genrsa -out "$CERTS_DIR/server.key" 2048
openssl req -new -key "$CERTS_DIR/server.key" -out "$CERTS_DIR/server.csr" -subj "/CN=localhost"
# Sign server certificate with CA
openssl x509 -req -in "$CERTS_DIR/server.csr" -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial -out "$CERTS_DIR/server.crt" -days 365 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1")

echo "Generating Client Certificate (Authorized)..."
openssl genrsa -out "$CERTS_DIR/client.key" 2048
openssl req -new -key "$CERTS_DIR/client.key" -out "$CERTS_DIR/client.csr" -subj "/CN=Test ORD Client"
# Sign client certificate with CA
openssl x509 -req -in "$CERTS_DIR/client.csr" -CA "$CERTS_DIR/ca.pem" -CAkey "$CERTS_DIR/ca.key" -CAcreateserial -out "$CERTS_DIR/client.crt" -days 365 -sha256

echo "Generating Unauthorized Client Certificate (signed by different CA)..."
openssl genrsa -out "$CERTS_DIR/unauth_ca.key" 2048
openssl req -x509 -new -nodes -key "$CERTS_DIR/unauth_ca.key" -sha256 -days 1024 -out "$CERTS_DIR/unauth_ca.pem" -subj "/CN=Unauthorized Test CA"
openssl genrsa -out "$CERTS_DIR/unauth_client.key" 2048
openssl req -new -key "$CERTS_DIR/unauth_client.key" -out "$CERTS_DIR/unauth_client.csr" -subj "/CN=Unauthorized Test Client"
openssl x509 -req -in "$CERTS_DIR/unauth_client.csr" -CA "$CERTS_DIR/unauth_ca.pem" -CAkey "$CERTS_DIR/unauth_ca.key" -CAcreateserial -out "$CERTS_DIR/unauth_client.crt" -days 365 -sha256


echo "Test certificates generated in $CERTS_DIR directory:"
echo "  CA: $CERTS_DIR/ca.pem, $CERTS_DIR/ca.key"
echo "  Server: $CERTS_DIR/server.crt, $CERTS_DIR/server.key"
echo "  Client (Authorized): $CERTS_DIR/client.crt, $CERTS_DIR/client.key"
echo "  Client (Unauthorized CA): $CERTS_DIR/unauth_client.crt, $CERTS_DIR/unauth_client.key, $CERTS_DIR/unauth_ca.pem"
echo ""
echo "To use for testing, set environment variables or CLI options:"
echo "  export MTLS_CA_PATH=\"$CERTS_DIR/ca.pem\""
echo "  export MTLS_CERT_PATH=\"$CERTS_DIR/server.crt\""
echo "  export MTLS_KEY_PATH=\"$CERTS_DIR/server.key\""
echo "  export MTLS_REJECT_UNAUTHORIZED=true"
echo ""
echo "Example curl command to test with client certificate:"
echo "  curl --cacert \"$CERTS_DIR/ca.pem\" --cert \"$CERTS_DIR/client.crt\" --key \"$CERTS_DIR/client.key\" https://localhost:8080/ord/v1/documents/example"
echo ""
echo "Example to test unauthorized client (should fail):"
echo "  curl --cacert \"$CERTS_DIR/unauth_ca.pem\" --cert \"$CERTS_DIR/unauth_client.crt\" --key \"$CERTS_DIR/unauth_client.key\" https://localhost:8080/ord/v1/documents/example"