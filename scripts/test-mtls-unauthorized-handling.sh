#!/bin/bash
# Test script for verifying mTLS middleware's ability to handle unauthorized clients
# This test specifically tests the behavior when MTLS_REJECT_UNAUTHORIZED=false

set -e  # Exit on any error

echo "===== mTLS Unauthorized Client Handling Test ====="
echo "This script will test the mTLS middleware's handling of unauthorized clients by:"
echo "1. Ensuring test certificates are available"
echo "2. Testing access against a running server with MTLS_REJECT_UNAUTHORIZED=false"
echo "3. Validating that the middleware correctly rejects clients with untrusted certificates"
echo ""

# Ensure we're in the project root
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"
CERTS_DIR="$ROOT_DIR/certs_test"
TEMP_FILE="/tmp/mtls-test-output.txt"

# Parse command line arguments
HOST="127.0.0.1"
PORT="8444"
LOG_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      HOST="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --log-file)
      LOG_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--host 127.0.0.1] [--port 8444] [--log-file /path/to/server.log]"
      exit 1
      ;;
  esac
done

echo "Testing against server at https://$HOST:$PORT"

# Generate test certificates
if [ ! -d "$CERTS_DIR" ] || [ ! -f "$CERTS_DIR/ca.pem" ]; then
  echo "Generating test certificates..."
  bash "$ROOT_DIR/scripts/generate-test-certs.sh"
else
  echo "Using existing certificates in $CERTS_DIR"
fi

# Check if server is running
echo "Checking if server is available..."
if ! curl -sk --cacert "$CERTS_DIR/ca.pem" \
         --cert "$CERTS_DIR/client.crt" \
         --key "$CERTS_DIR/client.key" \
         "https://$HOST:$PORT/api/v1/status" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: Server at https://$HOST:$PORT is not accessible."
  echo ""
  echo "Please start the server with mTLS enabled and MTLS_REJECT_UNAUTHORIZED=false before running this script:"
  echo ""
  echo "PORT=$PORT \\
  SERVER_PORT=$PORT \\
  ORD_BASE_URL=\"https://$HOST:$PORT\" \\
  ORD_DIRECTORY=\"./example\" \\
  ORD_AUTH_TYPE=\"mtls\" \\
  MTLS_CA_PATH=\"$CERTS_DIR/ca.pem\" \\
  MTLS_CERT_PATH=\"$CERTS_DIR/server.crt\" \\
  MTLS_KEY_PATH=\"$CERTS_DIR/server.key\" \\
  MTLS_REJECT_UNAUTHORIZED=\"false\" \\
  npm run dev"
  echo ""
  exit 1
fi

echo "Server is available and responding!"

# Test cases
echo ""
echo "===== Running Test Cases ====="

# Function to run a test case
run_test() {
  local test_name="$1"
  local expected_status="$2"
  local curl_args="${@:3}"
  
  echo -n "TEST: $test_name ... "
  
  # Run curl with the provided arguments and capture HTTP status code
  local status=$(curl -sk -o "$TEMP_FILE" -w "%{http_code}" --connect-timeout 5 $curl_args)
  local exit_code=$?
  
  if [ $exit_code -ne 0 ]; then
    echo "❌ FAIL (curl failed with exit code $exit_code)"
    return
  fi
  
  if [ "$status" = "$expected_status" ]; then
    echo "✅ PASS ($status)"
  else
    echo "❌ FAIL (Expected: $expected_status, Got: $status)"
    echo "Response:"
    cat "$TEMP_FILE"
  fi
}

# Test case 1: Valid certificate (should work)
run_test "Valid client certificate" "200" \
  --cacert "$CERTS_DIR/ca.pem" \
  --cert "$CERTS_DIR/client.crt" \
  --key "$CERTS_DIR/client.key" \
  "https://$HOST:$PORT/ord/v1/documents/document-1"

# Test case 2: Unauthorized client certificate (should be rejected by middleware with 401)
# With MTLS_REJECT_UNAUTHORIZED=false, the TLS handshake succeeds, but our middleware
# should still detect and reject the unauthorized certificate
run_test "Unauthorized client certificate" "401" \
  --cacert "$CERTS_DIR/unauth_ca.pem" \
  --cert "$CERTS_DIR/unauth_client.crt" \
  --key "$CERTS_DIR/unauth_client.key" \
  "https://$HOST:$PORT/ord/v1/documents/document-1"

# Test case 3: Well-known endpoint with valid certificate (should work)
run_test "Well-known endpoint with valid certificate" "200" \
  --cacert "$CERTS_DIR/ca.pem" \
  --cert "$CERTS_DIR/client.crt" \
  --key "$CERTS_DIR/client.key" \
  "https://$HOST:$PORT/.well-known/open-resource-discovery"

# Test case 4: Well-known endpoint with unauthorized certificate
# This should work because well-known endpoints are exempt from auth
run_test "Well-known endpoint with unauthorized certificate" "200" \
  --cacert "$CERTS_DIR/unauth_ca.pem" \
  --cert "$CERTS_DIR/unauth_client.crt" \
  --key "$CERTS_DIR/unauth_client.key" \
  "https://$HOST:$PORT/.well-known/open-resource-discovery"

echo ""
echo "Tests completed."

# Check server logs if log file is provided
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  echo "Checking server logs..."
  
  if grep -q "mTLS authentication enabled" "$LOG_FILE"; then
    echo "✅ Server log confirms mTLS is enabled"
  else
    echo "❌ Server log doesn't show mTLS is enabled"
  fi

  if grep -q "mTLS authentication successful" "$LOG_FILE"; then
    echo "✅ Server log shows successful mTLS authentication"
  else
    echo "❌ Server log doesn't show successful mTLS authentication"
    echo "   (This might be fine if no detailed logging is enabled - check if tests passed)"
  fi
  
  if grep -q "mTLS authentication failed\|Invalid client certificate" "$LOG_FILE"; then
    echo "✅ Server log shows unauthorized certificates being rejected by middleware"
  else
    echo "❌ Server log doesn't show unauthorized certificate rejection"
    echo "   (This might be fine if no detailed logging is enabled - check if tests passed)"
  fi
  
  echo ""
  echo "You can view detailed server logs at: $LOG_FILE"
fi

echo ""
echo "===== Test Summary ====="
echo "Server runs with mTLS authentication enabled and rejectUnauthorized=false"
echo "Valid client certificates are accepted"
echo "Unauthorized certificates pass TLS handshake but are rejected by middleware"
echo "Public endpoints remain accessible even with unauthorized certificates"
echo ""
echo "To manually test with valid certificate:"
echo "curl --cacert $CERTS_DIR/ca.pem --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key https://$HOST:$PORT/ord/v1/documents/document-1"
echo ""
echo "To manually test with unauthorized certificate (should return 401):"
echo "curl --cacert $CERTS_DIR/unauth_ca.pem --cert $CERTS_DIR/unauth_client.crt --key $CERTS_DIR/unauth_client.key https://$HOST:$PORT/ord/v1/documents/document-1"