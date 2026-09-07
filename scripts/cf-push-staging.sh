#!/usr/bin/env bash
# Deploy provider-server (with explorer linked locally) to CF staging.
# Strategy: pre-build everything locally so the file: dep is resolved before push,
# then strip it from package.json so CF's npm install doesn't choke on it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVIDER_DIR="$SCRIPT_DIR/.."
EXPLORER_DIR="$PROVIDER_DIR/../explorer-5-provider-server-in"

echo "==> Building explorer library..."
(cd "$EXPLORER_DIR" && npm run build:lib)

echo "==> Installing provider-server deps (resolves file: link to explorer)..."
(cd "$PROVIDER_DIR" && npm install)

echo "==> Building provider-server — backend (tsc) + UI (vite, bundles explorer)..."
(cd "$PROVIDER_DIR" && npm run build:all)

echo "==> Pruning to production deps..."
(cd "$PROVIDER_DIR" && npm prune --production)

echo "==> Patching package.json — removing explorer file: dep (already baked into dist/ui)..."
(cd "$PROVIDER_DIR" && node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  delete pkg.dependencies['@open-resource-discovery/explorer'];
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
")

echo "==> Logging into CF..."
cf login \
  -a https://api.cf.sap.hana.ondemand.com \
  -o CORE_CF \
  -s dev

echo "==> Pushing to CF (pre-built artifacts, CF installs remaining backend deps)..."
(cd "$PROVIDER_DIR" && cf push)

echo "==> Restoring package.json..."
(cd "$PROVIDER_DIR" && git checkout package.json)

echo "==> Restoring dev deps for local development..."
(cd "$PROVIDER_DIR" && npm install)

echo ""
echo "Done! Staging environment live at:"
echo "  https://ord-explorer-provider-server-dev.cfapps.sap.hana.ondemand.com"
