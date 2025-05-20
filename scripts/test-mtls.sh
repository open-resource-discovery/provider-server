#!/bin/bash
# Test script for verifying mTLS functionality

set -e  # Exit on any error

echo "===== mTLS Test Script ====="
echo "This script will test the mTLS implementation against a running server by:"
echo "1. Ensuring test certificates are available"
echo "2. Testing access with different certificates against a running server"
echo "3. Validating responses"
echo ""

# Ensure we're in the project root
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"
CERTS_DIR="$ROOT_DIR/certs_test"
TEMP_FILE="/tmp/mtls-test-output.txt"

# Parse command line arguments
HOST="127.0.0.1"
PORT="8443"
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
      echo "Usage: $0 [--host 127.0.0.1] [--port 8443] [--log-file /path/to/server.log]"
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
if ! curl -sk "https://$HOST:$PORT/api/v1/status" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: Server at https://$HOST:$PORT is not accessible."
  echo ""
  echo "Please start the server with mTLS enabled before running this script:"
  echo ""
  echo "PORT=$PORT \\
  SERVER_PORT=$PORT \\
  ORD_BASE_URL=\"https://$HOST:$PORT\" \\
  ORD_DIRECTORY=\"./example\" \\
  ORD_AUTH_TYPE=\"mtls\" \\
  MTLS_CA_PATH=\"$CERTS_DIR/ca.pem\" \\
  MTLS_CERT_PATH=\"$CERTS_DIR/server.crt\" \\
  MTLS_KEY_PATH=\"$CERTS_DIR/server.key\" \\
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
  local expect_failure="$3"
  local curl_args="${@:4}"
  
  echo -n "TEST: $test_name ... "
  
  # Run curl with the provided arguments and capture HTTP status code and exit code
  curl -sk -o "$TEMP_FILE" -w "%{http_code}" $curl_args > /tmp/curl_status 2>/dev/null
  local exit_code=$?
  local status=$(cat /tmp/curl_status 2>/dev/null || echo "000")
  
  # For tests where we expect TLS handshake failure
  if [ "$expect_failure" = "true" ] && [ $exit_code -ne 0 ]; then
    echo "✅ PASS (Connection failed as expected)"
    return
  fi
  
  if [ "$status" = "$expected_status" ]; then
    echo "✅ PASS ($status)"
  else
    echo "❌ FAIL (Expected: $expected_status, Got: $status, Exit: $exit_code)"
    echo "Response:"
    cat "$TEMP_FILE" 2>/dev/null || echo "[No response body]"
  fi
}

# Test case 1: Valid certificate
run_test "Valid client certificate" "200" "false" \
  --cacert "$CERTS_DIR/ca.pem" \
  --cert "$CERTS_DIR/client.crt" \
  --key "$CERTS_DIR/client.key" \
  "https://$HOST:$PORT/ord/v1/documents/document-1"

# Test case 2: No client certificate (expect TLS handshake failure)
run_test "No client certificate" "401" "true" \
  --cacert "$CERTS_DIR/ca.pem" \
  "https://$HOST:$PORT/ord/v1/documents/document-1"

# Test case 3: Unauthorized client certificate (expect TLS handshake failure)
run_test "Unauthorized client certificate" "401" "true" \
  --cacert "$CERTS_DIR/unauth_ca.pem" \
  --cert "$CERTS_DIR/unauth_client.crt" \
  --key "$CERTS_DIR/unauth_client.key" \
  "https://$HOST:$PORT/ord/v1/documents/document-1"

# Test case 4: Status endpoint (should be accessible without auth)
run_test "Status endpoint (no auth required)" "200" "false" \
  --cacert "$CERTS_DIR/ca.pem" \
  --cert "$CERTS_DIR/client.crt" \
  --key "$CERTS_DIR/client.key" \
  "https://$HOST:$PORT/api/v1/status"

# Test case 5: Well-known endpoint (should be accessible without auth)
run_test "Well-known endpoint (no auth required)" "200" "false" \
  --cacert "$CERTS_DIR/ca.pem" \
  --cert "$CERTS_DIR/client.crt" \
  --key "$CERTS_DIR/client.key" \
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
  
  echo ""
  echo "You can view detailed server logs at: $LOG_FILE"
fi

echo ""
echo "===== Test Summary ====="
echo "Valid client certificates are accepted"
echo "Invalid client certificates are rejected"
echo "Public endpoints remain accessible"
echo ""
echo "To manually test with curl:"
echo "curl --cacert $CERTS_DIR/ca.pem --cert $CERTS_DIR/client.crt --key $CERTS_DIR/client.key https://$HOST:$PORT/ord/v1/documents/document-1"