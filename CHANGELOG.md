# CHANGELOG

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [unreleased]

- Rename access strategy `sap.businesshub:basic-auth:v1` to `basic-auth`
- Update ORD schema to v1.12.3

## [[0.10.1](https://github.com/open-resource-discovery/provider-server/releases/tag/v0.10.1)] - 2025-10-10

### Added

- Automatic injection of `describedSystemVersion` field for ORD documents with perspective type `system-version`, that don't have one
- More tests
- Utilizing `isomorphic-git` to clone repositories instead of using GitHub API

### Changed

- Caching behavior: Instant cache warm up after a clone / pull (non-blocking)

## [0.9.2] - 2025-07-22

### Changed

- Respond successfully to the GitHub `ping` event

## [0.9.1] - 2025-07-22

### Changed

- Secured `/api/v1/status` endpoint with authentication
- Opened `/api/v1/webhook/github` for external GitHub webhook events

## [0.9.0] - 2025-07-21

### Added

- `/status` serves now an interactive dashboard
- Live dashboard updates served by websockets
- Github Webhook event integration

### Changed

- Retrieve Github data by fetching the given directory and serve from disk

## [0.8.2] - 2025-04-16

### Added

- HTTP response headers now have a new entry: `x-ord-provider-server-version`
- New API endpoint `/api/v1/status`
- Documentation for re-deployment on CF

### Changed

- Validation order of parameters / arguments / directories & files
- Resilient URL (trailing slashes) checks

## [0.8.1] - 2025-04-14

### Changed

- Improved GitHub file fetching, by adding a fallback to the `blobs` API, when file content is too large

## [0.8.0] - 2025-04-08

### Added

- Standardized path handling

### Changed

- Improved Caching
- Encapsulated business logic

## [0.7.4] - 2025-03-25

- Workflow file changes
- Support for a custom location of ORD documents

## [0.7.3] - 2025-03-19

- Dependency updates

## [0.7.2] - 2025-03-18

- Dependency updates

## [0.7.1] - 2025-03-14

### Added

- Release Workflow

### Changed

- Using `bcryptjs` instead of `bcrypt`

## [0.7.0] - 2025-02-20

### BREAKING CHANGES

- `--github-host` was changed to `--github-api-url`
- `GITHUB_HOST` was changed to `GITHUB_API_URL`
- `ORD_AUTH` was changed to `ORD_AUTH_TYPE`

## [0.6.2] - 2025-02-18

### Added

- Primitive check for valid ORD Documents
- De-espacing incoming requests, like escaped ORD IDs, to fully qualified ORD IDs when possible

## [0.6.1] - 2025-02-04

### BREAKING CHANGES

- Authentication method "UCL-mTLS" is removed

### Notes

- This version requires configurations updates for existing servers, as UCL-mTLS is removed.

## [0.6.0] - 2025-01-30

### Added

- Enhanced baseUrl validation and documentation
- Added better error checks for authentication
- Implemented GitHub connection validation at startup
- Added basic local and GitHub directory validation at startup

### Changed

- Improved documentation for authentication and configuration
- Enhanced validation for Basic Auth and UCL-mTLS
- Introduced structured validation error handling
- Setup document URLs with `/ord/v1` prefix

## [0.5.1] - 2025-01-23

### BREAKING CHANGES

- Made `baseUrl` argument mandatory
- Changed UCL-mTLS endpoints configuration to require an array format
- Modified default access control strategy to `open`

### New Features

- Added support for custom directory in the GitHub source type
- Implemented .env fallback support for all configuration arguments
- Added automatic `baseUrl` replacement in ORD Documents

### Notes

- This version requires configurations updates for existing implementations
- Review your UCL-mTLS endpoint configurations to ensure array format compliance

## [0.2.0] - 2022-01-26

- **BREAKING**: The ORD Provider Server now uses the [SAP CMP mTLS access strategy](https://pages.github.tools.sap/CentralEngineering/open-resource-discovery-specification/#/access-strategies/sap-cmp-mtls-v1) by default (protected)

## [0.1.0] - 2021-05-27

### Added

- First MVP of ORD Provider Server
