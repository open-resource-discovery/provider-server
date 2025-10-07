[![REUSE status](https://api.reuse.software/badge/github.com/open-resource-discovery/provider-server)](https://api.reuse.software/info/github.com/open-resource-discovery/provider-server)

# Open Resource Discovery Provider Server

This project helps to expose static metadata using [Open Resource Discovery](https://open-resource-discovery.github.io/specification/) (ORD) protocol via HTTP endpoint. Exposed metadata can be consumed by other application/services or [aggregators](https://open-resource-discovery.github.io/specification/spec-v1#ord-aggregator).

## Usage

Replace "/path-to-your-metadata" with the directory, that has your ORD Documents.

### Via **Docker**

1. **Local** (default: open)

```bash
docker run -p 8080:8080 \
           -v "$(pwd)/path-to-your-metadata:/app/data" \
           ghcr.io/open-resource-discovery/provider-server:latest \
           -d /app/data \
           --base-url 'http://127.0.0.1:8080'
```

2. **Local** (basic auth)

```bash
docker run -p 8080:8080 -v "$(pwd)/path-to-your-metadata:/app/data" \
  -e BASIC_AUTH='{"admin":"$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG."}' \
  ghcr.io/open-resource-discovery/provider-server:latest \
  -d /app/data --auth basic --base-url 'http://127.0.0.1:8080'
```

3. **GitHub** (open)

```bash
docker run -p 8080:8080 \
  -e GITHUB_TOKEN="<your-token>" \
  -e WEBHOOK_SECRET="<your-webhook-secret>" \
  -e UPDATE_DELAY="30" \
  -e STATUS_DASHBOARD_ENABLED="true" \
  -e LOG_LEVEL="info" \
  ghcr.io/open-resource-discovery/provider-server:latest \
  -s github \
  --github-api-url "https://api.github.com" \
  --github-repository "owner/repo" \
  --github-branch "main" \
  --base-url 'http://127.0.0.1:8080'
```

### Via **npx**

**Prerequisites**

- Node.js >=22.8.0
- NPM >=10.8.2

1. **Local** (default: open)

```bash
 npx @open-resource-discovery/provider-server -d /path-to-your-metadata --base-url 'http://127.0.0.1:8080'
```

2. **Local** (basic auth)

```bash
 BASIC_AUTH='{"admin":"$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG."}' npx @open-resource-discovery/provider-server -d /path-to-your-metadata --auth basic --base-url 'http://127.0.0.1:8080'
```

3. **GitHub** (open)

```bash
 npx @open-resource-discovery/provider-server -s github \
   --github-api-url "https://api.github.com" \
   --github-repository "owner/repo" \
   --github-branch "main" \
   --github-token "<your-token>" \
   --base-url 'http://127.0.0.1:8080'
```

### CLI Options

```bash
npx @open-resource-discovery/provider-server --help
```

| Option                                 | Default                  | Required               | Env Var                      | Description                                                                                                                                           |
| -------------------------------------- | ------------------------ | ---------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-b, --base-url <type>`                | `local`                  | Yes                    | `ORD_BASE_URL`               | Base URL of the server. If deployed in CF environment, the VCAP_APPLICATION env will be used as fallback                                              |
| `-s, --source-type <type>`             | `local`                  | No                     | `ORD_SOURCE_TYPE`            | Source type for ORD Documents (`local` or `github`)                                                                                                   |
| `-a, --auth <types>`                   | `open`                   | No                     | `ORD_AUTH_TYPE`              | Server authentication method(s) (`open`, `basic`)                                                                                                     |
| `-d, --directory <path>`               | -                        | Yes (for local)        | `ORD_DIRECTORY`              | Root directory containing the ORD Documents directory and resource definition files.                                                                  |
| `-ds, --documents-subdirectory <path>` | `documents`              | No                     | `ORD_DOCUMENTS_SUBDIRECTORY` | Directory containing the ORD Documents with at least one ORD document. Supports nested folder structures. Can also be applied to a GitHub Repository. |
| `--host <host>`                        | `0.0.0.0`                | No                     | `SERVER_HOST`                | Host for server, without port                                                                                                                         |
| `--port <number>`                      | `8080`                   | No                     | `SERVER_PORT`                | Server port                                                                                                                                           |
| `--github-api-url <apiUrl>`            | `https://api.github.com` | Yes (for github)       | `GITHUB_API_URL`             | GitHub API endpoint for API calls                                                                                                                     |
| `--github-branch <branch>`             | `main`                   | Yes (for github)       | `GITHUB_BRANCH`              | GitHub branch to use                                                                                                                                  |
| `--github-repository <repo>`           | -                        | Yes (for github)       | `GITHUB_REPOSITORY`          | GitHub repository in format `<OWNER>/<REPO>`                                                                                                          |
| `--github-token <token>`               | -                        | Yes (for github)       | `GITHUB_TOKEN`               | GitHub token for authentication                                                                                                                       |
| `--update-delay <seconds>`             | `5`                      | No                     | `UPDATE_DELAY`               | Cooldown between webhook-triggered updates (seconds)                                                                                                  |
| `--status-dashboard-enabled <boolean>` | `true`                   | No                     | `STATUS_DASHBOARD_ENABLED`   | Enable/disable status dashboard (true/false)                                                                                                          |
| `--mtls-ca-path <path>`                | -                        | Yes (for mtls)         | `MTLS_CA_PATH`               | Path to CA certificate for validating client certificates                                                                                             |
| `--mtls-cert-path <path>`              | -                        | Yes (for mtls)         | `MTLS_CERT_PATH`             | Path to server certificate                                                                                                                            |
| `--mtls-key-path <path>`               | -                        | Yes (for mtls)         | `MTLS_KEY_PATH`              | Path to server private key                                                                                                                            |
| `--mtls-reject-unauthorized`           | `true`                   | No                     | `MTLS_REJECT_UNAUTHORIZED`   | Reject unauthorized clients (set to 'false' to allow unauthorized certs, not recommended for production)                                              |
| `--mtls-mode <mode>`                   | `standard`               | No                     | `MTLS_MODE`                  | mTLS mode (`standard` or `sap:cmp-mtls`)                                                                                                              |
| `--mtls-trusted-issuers <issuers>`     | -                        | No\*                   | `MTLS_TRUSTED_ISSUERS`       | Semicolon-separated list of trusted certificate issuers (DN format)                                                                                   |
| `--mtls-trusted-subjects <subjects>`   | -                        | No\*                   | `MTLS_TRUSTED_SUBJECTS`      | Semicolon-separated list of trusted certificate subjects (DN format)                                                                                  |
| `--mtls-config-endpoints <endpoints>`  | -                        | Yes (for sap:cmp-mtls) | `MTLS_CONFIG_ENDPOINTS`      | Semicolon-separated list of URLs to fetch certificate configuration from                                                                              |

### Environment-Only Variables

Some configuration options are only available as environment variables for security reasons:

| Environment Variable | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `WEBHOOK_SECRET`     | GitHub webhook secret for signature validation (required for webhook security in GitHub mode)        |
| `BASIC_AUTH`         | JSON object with username:password-hash pairs for basic authentication (e.g., `{"admin":"$2y$..."})` |

## System Requirements

The provider server's resource requirements depend on your repository size and content type.

### Memory (RAM) Requirements

Memory usage varies based on content type:

#### ORD Documents (in `documents/` folder)

- **Formula**: ~4× document size
- **Reason**: Validation, parsing, caching, and processing overhead
- **Example**: 500MB of ORD documents → 2GB RAM

#### Resource Definition Files (outside `documents/` folder)

- **Formula**: ~2× file size
- **Reason**: Git clone operations only, no validation overhead
- **Example**: 500MB of resource files → ~1GB RAM

#### Combined Example

If you have 500MB ORD documents + 500MB resource files:

- ORD documents: 500MB × 4 = 2GB
- Resource files: 500MB × 2 = 1GB
- **Total**: ~3GB RAM recommended

#### General Recommendations

- **Small repositories** (<10MB): 512MB RAM minimum
- **Medium repositories** (10-500MB): 1-2GB RAM
- **Large repositories** (>500MB): Calculate using formulas above

### Disk Space Requirements

**Formula**: Total repository size × 2.5

**Reason**: Space needed for:

- Git repository clone
- Working directory
- Temporary directory during updates

**Examples**:

- 10MB repository → ~25MB disk space
- 100MB repository → ~250MB disk space
- 1GB repository → ~2.5GB disk space

#### General Recommendations

- **Small repositories** (<10MB): 512MB disk minimum
- **Medium repositories** (10-500MB): 1-2GB disk
- **Large repositories** (>500MB): Calculate using formula above

> **Note**: These are minimum recommendations. Consider adding 20-30% buffer for optimal performance and to handle temporary spikes during operations.

### Required Structure

The specified directory path (`-d`) should contain a documents directory (configurable via `--documents-subdirectory`, default is `documents`) with at least one valid ORD Document. Other resources referenced by ORD Documents can be placed anywhere in the specified directory.

This structure applies to both source types:

- **Local** (`-s local`): The path points to a local directory
- **GitHub** (`-s github`): The path specifies a subdirectory within the repository

```
./<directory>/                            # Directory specified with -d
├── documents/                            # Default folder containing ORD Document(s) (configurable via --documents-subdirectory)
│   └── ord-document.json                 # ORD Document
└── <ord-id-1>                            # Optional resources
    └── <resource-definition-file-1>
└── <ord-id-2>                            # Optional resources
    ├── <resource-definition-file-2>
    └── <resource-definition-file-3>
```

#### Example with Default Structure:

```
./my-ord-provider/                                        # Directory specified with -d
├── documents/                                            # Default folder containing ORD Document(s)
│   ├── ord-document.json                                 # ORD Document
│   └── ord-document2.json                                # Additional ORD Document
└── sap.xref:apiResource:astronomy:v1/                    # Optional resources
    └── openapi-v3.json
└── sap.xref:apiResource:astronomy:v2/                    # Optional resources
    ├── openapi-v3.json
    └── _metadata.json
└── sap.xref:eventResource:odm-finance-costobject:v0/     # Optional resources
    └── asyncapi-v3.json
```

#### Important Notes:

1. **ORD Documents Location**
   - All ORD Documents must be placed in the documents directory (configurable via `--documents-subdirectory`, default is `documents/`)
   - ORD Documents can be placed in nested folders within the documents directory
   - Supported format: `.json`

2. **Resource References**
   - Resources referenced in the ORD Documents can be placed anywhere within the `-d` directory
   - The URLs in the ORD Document's `resourceDefinitions` must match the relative paths from the `-d` directory
   - Example resource definition in an ORD Document:
     ```json
     {
       "resourceDefinitions": [
         {
           "type": "openapi-v3",
           "mediaType": "application/json",
           "url": "/apis/api-one/openapi.json"
         }
       ]
     }
     ```
   - The server will resolve `/apis/api-one/openapi.json` relative to the `-d` directory
   - The access strategies of the `resourceDefinitions` will be overwritten by the provided authentication method

3. **Base URL**
   - The `baseUrl` is a required parameter that must match the format specified in the [ORD Specification](https://open-resource-discovery.github.io/specification/spec-v1/interfaces/configuration#ord-configuration_baseurl).
   - For local development:
     - Use `http://127.0.0.1:8080` instead of `localhost`
     - Alternatively, use a [Fully Qualified Domain Name (FQDN)](https://en.wikipedia.org/wiki/Fully_qualified_domain_name)
   - This `baseUrl` value will:
     - Be set in the ORD Configuration
     - Override the existing baseUrl in the `describedSystemInstance` field of any ORD Documents

### Perspective Filtering

The ORD Configuration endpoint supports filtering documents by perspective using the `?perspective=` query parameter:

```bash
# Get all documents (default)
curl http://127.0.0.1:8080/.well-known/open-resource-discovery

# Filter by perspective
curl http://127.0.0.1:8080/.well-known/open-resource-discovery?perspective=system-version
curl http://127.0.0.1:8080/.well-known/open-resource-discovery?perspective=system-instance
curl http://127.0.0.1:8080/.well-known/open-resource-discovery?perspective=system-independent
```

> [!NOTE]
> ORD documents without an explicit `perspective` property default to `system-instance`.

### Authentication

By default, if no `--auth` parameter is specified, the server starts without authentication.

#### Open

When the `open` authentication parameter is used, the server bypasses authentication checks.

> Cannot be used together with other authentication types.

#### Basic Authentication

The server supports Basic Authentication through an environment variable that contains a JSON string mapping usernames to bcrypt-hashed passwords:

```json
{ "admin": "$2a$05$....", "reader": "$2y$a2$" }
```

To generate hashes, use [htpasswd](https://httpd.apache.org/docs/2.4/programs/htpasswd.html) utility:

```bash
htpasswd -Bnb <user> <password>
```

This will output something like `admin:$2y$05$...` - use only the hash part (starting with `$2y$`) in your `BASIC_AUTH` JSON.

> [!IMPORTANT]
> Make sure to use strong passwords and handle the BASIC_AUTH environment variable securely. Never commit real credentials or .env files to version control.

#### Mutual TLS (mTLS) Authentication

The server supports Mutual TLS (mTLS) authentication, which provides stronger security through certificate-based client authentication. When mTLS is enabled, both the server and client must present a certificate signed by a trusted certificate authority (CA).

To use mTLS:

1. **Generate Certificates**: You need:
   - A CA certificate for validating client certificates
   - A server certificate and private key
   - Client certificates signed by the CA

2. **Configure the Server** with the necessary certificate paths:

   ```bash
   npm run dev -- --auth mtls \
     --mtls-ca-path ./certs/ca.pem \
     --mtls-cert-path ./certs/server.crt \
     --mtls-key-path ./certs/server.key
   ```

3. **With Docker**:
   ```bash
   docker run -p 8443:8443 \
     -v "$(pwd)/path-to-your-metadata:/app/data" \
     -v "$(pwd)/certs:/app/certs" \
     ghcr.io/open-resource-discovery/provider-server:latest \
     -d /app/data \
     --auth mtls \
     --mtls-ca-path /app/certs/ca.pem \
     --mtls-cert-path /app/certs/server.crt \
     --mtls-key-path /app/certs/server.key \
     --base-url 'https://example.com'
   ```

**Example with certificate validation:**

```bash
# Option 1: Set trusted issuers and subjects
export MTLS_TRUSTED_ISSUERS="CN=My Company CA,O=My Company,C=US"
export MTLS_TRUSTED_SUBJECTS="CN=api-client,O=My Company,C=US;CN=web-client,O=My Company,C=US"

# Option 2: Fetch from endpoints (can be used together with Option 1)
export MTLS_CONFIG_ENDPOINTS="https://config.mycompany.com/api/mtls-certs"

# Start the server
npm run dev -- --auth mtls \
  --mtls-ca-path ./certs/ca.pem \
  --mtls-cert-path ./certs/server.crt \
  --mtls-key-path ./certs/server.key \
  --base-url 'https://api.example.com'
```

Example curl command to test manually with client certificates:

```bash
curl --cacert ./your_ca.pem \
     --cert ./your_client.crt \
     --key ./your_client.key \
     https://127.0.0.1:8080/ord/v1/documents/example
```

> [!IMPORTANT]
>
> - The server automatically switches to HTTPS when mTLS is enabled
> - Ensure all certificates are properly secured and maintained
> - The `MTLS_REJECT_UNAUTHORIZED` flag controls whether TLS handshakes with unauthorized clients are rejected immediately (default), or if they're handled by the middleware

##### Advanced mTLS Configuration

The server supports additional mTLS configuration options for fine-grained control over client certificate validation:

###### Trusted Issuers and Subjects

You can restrict which client certificates are accepted by specifying trusted certificate issuers and subjects:

**Environment Variables:**

- `MTLS_TRUSTED_ISSUERS` - Semicolon-separated list of trusted certificate issuers
- `MTLS_TRUSTED_SUBJECTS` - Semicolon-separated list of trusted certificate subjects

Example:

```bash
export MTLS_TRUSTED_ISSUERS="CN=My Company CA,O=My Company,C=US;CN=Partner CA,O=Partner Inc,C=US"
export MTLS_TRUSTED_SUBJECTS="CN=allowed-client,O=My Company,C=US"
```

###### Dynamic Certificate Configuration

For environments where trusted certificates need to be managed dynamically, the server supports fetching certificate information from external endpoints:

**Environment Variable:**

- `MTLS_CONFIG_ENDPOINTS` - Semicolon-separated list of URLs that return certificate configuration

Each endpoint should return a JSON response with the following fields:

```json
{
  "certIssuer": "CN=My Company CA,O=My Company,C=US;CN=Partner CA,O=Partner Inc,C=US",
  "certSubject": "CN=allowed-client,O=My Company,C=US"
}
```

Example configuration:

```bash
export MTLS_CONFIG_ENDPOINTS="https://dev.example.com/mtls-certs;https://stage.example.com/certs"
```

The server will:

1. Fetch certificate information from all configured endpoints at startup
2. Merge the results with any statically configured trusted issuers/subjects
3. Use the combined list for client certificate validation

> [!NOTE]
>
> - If an endpoint is unreachable, the server will log a warning and continue with other endpoints
> - Both static configuration (via `MTLS_TRUSTED_ISSUERS/SUBJECTS`) and dynamic configuration (via `MTLS_CONFIG_ENDPOINTS`) can be used together
> - The values from `MTLS_CONFIG_ENDPOINTS` are added to (not replacing) any values from `MTLS_TRUSTED_ISSUERS` and `MTLS_TRUSTED_SUBJECTS`
> - Each endpoint has a default timeout of 10 seconds

###### SAP BTP (Cloud Foundry) mTLS Mode

For Cloud Foundry deployments, the server supports a special mTLS mode that validates certificates using headers provided by the platform's proxy:

```bash
export MTLS_MODE="sap:cmp-mtls"
export MTLS_CONFIG_ENDPOINTS="https://config.example.com/mtls-certs"
```

In this mode:

- The server validates client certificates using SAP CF-specific headers (X-SSL-Client-Verify, X-SSL-Client-Subject-DN, etc.)
- Certificate validation is performed by the platform's HAProxy/Gorouter
- `MTLS_CONFIG_ENDPOINTS` is **mandatory** and must provide certificate configuration
- At least one trusted issuer and subject must be available (from environment variables or config endpoints)
- You can combine static configuration (`MTLS_TRUSTED_ISSUERS`, `MTLS_TRUSTED_SUBJECTS`) with dynamic endpoints

#### Multiple Authentication Methods

The server supports using multiple authentication methods simultaneously by providing a comma-separated list of authentication methods. When multiple methods are specified, a request will be authenticated if it passes any of the specified authentication methods.

Currently, the following combination is supported:

- `mtls,basic` - Authenticate with either mTLS certificate or basic authentication

Example usage:

```bash
# Using both mTLS and basic authentication
npm run dev -- --auth mtls,basic \
  --mtls-ca-path ./certs/ca.pem \
  --mtls-cert-path ./certs/server.crt \
  --mtls-key-path ./certs/server.key \
  --base-url 'https://example.com'
```

> [!NOTE]
> When using multiple authentication methods:
>
> - The `open` method cannot be combined with any other method
> - All requirements for each individual authentication method still apply (e.g., you need to provide both basic auth credentials and mTLS certificates)
> - The server will try each authentication method in sequence until one succeeds

<details>
<summary>Using htpasswd in your environment</summary>

- **Platform independent**:

  > Prerequisite is to have [NodeJS](https://nodejs.org/en) installed on the machine.

  ```bash
  npm install -g htpasswd
  ```

  After installing package globally, command `htpasswd` should be available in the Terminal.

- **macOS**:

  Installation of any additional packages is not required. Utility `htpasswd` is available in Terminal by default.

- **Linux**:

  Install apache2-utils package:

  ```bash
  # Debian/Ubuntu
  sudo apt-get install apache2-utils

  # RHEL/CentOS
  sudo yum install httpd-tools
  ```

</details>

### Cloud Foundry Deployment

First, install the Cloud Foundry CLI by following the official documentation:
[Cloud Foundry CLI Installation](https://docs.cloudfoundry.org/cf-cli/install-go-cli.html).

The ORD Provider Server can be deployed to Cloud Foundry either by using Cloud Foundry CLI to deploy our Docker image or via a manifest file with the Node.js buildpack.

#### Via CF CLI

Deploy using our Docker image from the private repository:

```bash
# 1. Login to Cloud Foundry
cf login -a <api-url> -o <org> -s <space>

# 2. Push the app without starting it
cf push <your-app-name> \
--no-manifest \
--docker-image "ghcr.io/open-resource-discovery/provider-server:latest" \
--docker-username <docker-username> \
--memory 512MB \
--disk 512MB \
--no-route \
--no-start

# 3. Set all environment variables
cf set-env <your-app-name> ORD_SOURCE_TYPE <github|local>
cf set-env <your-app-name> GITHUB_BRANCH <branch_name>
cf set-env <your-app-name> GITHUB_API_URL <url>
cf set-env <your-app-name> GITHUB_REPOSITORY <owner/repo>
cf set-env <your-app-name> GITHUB_TOKEN <github_token>

# 4. Add and map a route for your app
cf map-route <your-app-name> <domain> --hostname <your-app-name>

# 5. Start the app
cf start <your-app-name>
```

<details>
<summary>Via CF Manifest (Alternative Approach)</summary>

You can also deploy your current repository using a manifest file:

1. Create `manifest.yaml`:

```yaml
---
applications:
  - name: <your-app-name>
    buildpacks:
      - nodejs_buildpack
    instances: 1
    memory: 512M
    disk_quota: 512M
    routes:
      - route: <your-app-name>.example.com
    env:
      GITHUB_BRANCH: <branch_name>
      GITHUB_API_URL: <url>
      GITHUB_REPOSITORY: <owner/repository>
      GITHUB_TOKEN: <ghp_token>
      ORD_SOURCE_TYPE: <github|local>
```

2. Deploy:

```bash
cf push
```

</details>

##### Re-deploy a CF app

```bash

# 1. Login to Cloud Foundry
cf login -a <api-url> -o <org> -s <space>

# 2. Push the updated app
cf push <your-app-name> \
--no-manifest \
--docker-image "ghcr.io/open-resource-discovery/provider-server:<your-new-version>" \
--docker-username <docker-username>
```

## GitHub Token Permissions

When using the GitHub source type (`-s github`), you need to provide a GitHub token with appropriate permissions. Both fine-grained personal access tokens (PATs) and classic tokens are supported.

### Required Permissions

For **Fine-grained personal access tokens**:

- **Repository Access**: Select the specific repository(ies) you need access to
- **Permissions**: Only `Contents` with `Read-only` access is required

For **Tokens (classic)**:

- **Repository Access**:
  - `repo` access for private repositories
  - `public_repo` scope for public repositories only

## GitHub Webhooks

When using the GitHub source type (`-s github`), you can configure webhooks to automatically update content when changes are pushed to your repository.

### Setting up GitHub Webhooks

1. Go to your GitHub repository → Settings → Webhooks
2. Click "Add webhook"
3. Configure the webhook:
   - **Payload URL**: `https://your-server.com/api/v1/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: A secure random string
   - **Events**: Select "Just the push event"

### Update Delay

The `--update-delay` parameter sets a cooldown period between webhook-triggered updates. This prevents excessive updates when multiple commits are pushed in quick succession. During the cooldown period, only the latest push event will be processed after the delay expires.

## Status Dashboard

The provider server includes a built-in status dashboard accessible at `/status` that provides real-time monitoring of your ORD provider.
Navigate to `http://127.0.0.1:8080/status` in your browser.

When disabled, `/status` will redirect to the ORD endpoint.

## License

Copyright 2025 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](.reuse/dep5).
