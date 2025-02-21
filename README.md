# Open Resource Discovery Provider Server

This project can help to turn static metadata and [Open Resource Discovery](https://open-resource-discovery.github.io/specification/) (ORD) documents into a valid ORD Provider implementation.

This project can be used either as a CLI tool or as a Node.js NPM dependency.

## Prerequisites

- Node.js >=22.8.0
- NPM >=10.8.2

## Usage

### Via **npx**
1. **Local** (default: open)
  ```bash
   npx @open-resource-discovery/provider-server -d ./example --base-url 'http://127.0.0.1:8080'
  ```

2. **Local** (basic auth)
  ```bash
   BASIC_AUTH='{"admin":"$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG."}' npx @open-resource-discovery/provider-server -d ./example --auth basic --base-url 'http://127.0.0.1:8080'
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

### Via **Docker**

1. **Local** (default: open)
```bash
docker run -p 8080:8080 -v "$(pwd)/example:/app/data" \
  ghcr.io/open-resource-discovery/provider-server:latest \
  -d /app/data --base-url 'http://127.0.0.1:8080'
```

2. **Local** (basic auth)
```bash
docker run -p 8080:8080 -v "$(pwd)/example:/app/data" \
  -e BASIC_AUTH='{"admin":"$2y$05$TjeC./ljKi7VLTBbzjTVyOi6lQBYpzfXiZSfJiGECHVi0eEN6/QG."}' \
  ghcr.io/open-resource-discovery/provider-server:latest \
  -d /app/data --auth basic --base-url 'http://127.0.0.1:8080'
```

3. **GitHub** (open)
```bash
docker run -p 8080:8080 \
  -e GITHUB_TOKEN="<your-token>" \
  ghcr.io/open-resource-discovery/provider-server:latest \
  -s github \
  --github-api-url "https://api.github.com" \
  --github-repository "owner/repo" \
  --github-branch "main" \
  --base-url 'http://127.0.0.1:8080'
```

### CLI Options
```bash
npx @open-resource-discovery/provider-server --help
```

| Option | Default | Required | Env Var | Description |
|--------|---------|-----------|---------|-------------|
| `-b, --base-url <type>` | `local` | Yes | `ORD_BASE_URL` | Base URL of the server. If deployed in CF environment, the VCAP_APPLICATION env will be used as fallback |
| `-s, --source-type <type>` | `local` | No | `ORD_SOURCE_TYPE` | Source type for ORD Documents (`local` or `github`) |
| `-a, --auth <types>` | `open` | No | `ORD_AUTH_TYPE` | Server authentication method(s) (`open`, `basic`) |
| `-d, --directory <path>` | - | Yes (for local) | `ORD_DIRECTORY` | Directory containing the `/documents` directory with at least one ORD document. Can also be applied to a GitHub Repository. |
| `--host <host>` | `0.0.0.0` | No | `SERVER_HOST` | Host for server, without port |
| `--port <number>` | `8080` | No | `SERVER_PORT` | Server port |
| `--github-api-url <apiUrl>` | `https://api.github.com` | Yes (for github) | `GITHUB_API_URL` | GitHub API endpoint for API calls |
| `--github-branch <branch>` | `main` | Yes (for github) | `GITHUB_BRANCH` | GitHub branch to use |
| `--github-repository <repo>` | - | Yes (for github) | `GITHUB_REPOSITORY` | GitHub repository in format `<OWNER>/<REPO>` |
| `--github-token <token>` | - | Yes (for github) | `GITHUB_TOKEN` | GitHub token for authentication |

### Required Structure
The specified directory path (`-d`) should contain a `documents` directory with at least one valid ORD Document. Other resources referenced by ORD Documents can be placed anywhere in the specified directory.

This structure applies to both source types:
- **Local** (`-s local`): The path points to a local directory
- **GitHub** (`-s github`): The path specifies a subdirectory within the repository

```
./<directory>/                            # Directory specified with -d
├── documents/                            # Required folder containing ORD Document(s)
│   └── ord-document.json                 # ORD Document
└── <ord-id-1>                            # Optional resources
    └── <resource-definition-file-1>
└── <ord-id-2>                            # Optional resources
    ├── <resource-definition-file-2>
    └── <resource-definition-file-3>
```

#### Example:
```
./my-ord-provider/                                        # Directory specified with -d
├── documents/                                            # Required folder containing ORD Document(s)
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
   - All ORD Documents must be placed in the `documents/` folder
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

### Authentication
By default, if no `--auth` parameter is specified, the server starts without authentication.

#### Open
When the `open` authentication parameter is used, the server bypasses authentication checks.
> Cannot be used together with other authentication types.

#### Basic Authentication
The server supports Basic Authentication through an environment variable that contains a JSON string mapping usernames to bcrypt-hashed passwords:
```json
{"admin":"$2a$05$....", "reader":"$2y$a2$"}
```

You can generate these bcrypt-hashed passwords using the `htpasswd` utility:

##### Installing htpasswd:
- **Linux**: Install apache2-utils package
  ```bash
  # Debian/Ubuntu
  sudo apt-get install apache2-utils
  # RHEL/CentOS
  sudo yum install httpd-tools
  ```
- **macOS**: Install via Homebrew
  ```bash
  brew install httpd
  ```
- **Windows**: Available through [XAMPP](https://www.apachefriends.org/) or [Apache Haus](https://www.apachehaus.com/cgi-bin/download.plx)

##### Generating a password hash:
```bash
htpasswd -Bnb admin secret
```
This will output something like `admin:$2y$05$...` - use only the hash part (starting with $2y$) in your BASIC_AUTH JSON.

> **Security Note**: Make sure to use strong passwords and handle the BASIC_AUTH environment variable securely. Never commit real credentials or .env files to version control.

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
--memory 256MB \
--disk 256MB \
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
    memory: 256M
    disk_quota: 256M
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


## License
Copyright 2025 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](.reuse/dep5).
