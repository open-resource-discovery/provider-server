# Contributing

## Code of Conduct

All members of the project community must abide by the [SAP Open Source Code of Conduct](https://github.com/open-resource-discovery/.github/blob/main/CODE_OF_CONDUCT.md).
Only by respecting each other we can develop a productive, collaborative community.
Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by contacting [a project maintainer](.reuse/dep5).

## Engaging in Our Project

We use GitHub to manage reviews of pull requests.

- If you are a new contributor, see: [Steps to Contribute](#steps-to-contribute)

- Before implementing your change, create an issue that describes the problem you would like to solve or the code that should be enhanced. Please note that you are willing to work on that issue.

- The team will review the issue and decide whether it should be implemented as a pull request. In that case, they will assign the issue to you. If the team decides against picking up the issue, the team will post a comment with an explanation.

## Steps to Contribute

Should you wish to work on an issue, please claim it first by commenting on the GitHub issue that you want to work on. This is to prevent duplicated efforts from other contributors on the same issue.

If you have questions about one of the issues, please comment on them, and one of the maintainers will clarify.

## Contributing Code or Documentation

You are welcome to contribute code in order to fix a bug or to implement a new feature that is logged as an issue.

The following rule governs code contributions:

- Contributions must be licensed under the [Apache 2.0 License](./LICENSE).
- Due to legal reasons, contributors will be asked to accept a Developer Certificate of Origin (DCO) when they create the first pull request to this project. This happens in an automated fashion during the submission process. SAP uses [the standard DCO text of the Linux Foundation](https://developercertificate.org/).
- Contributions must follow our [guidelines on AI-generated code](https://github.com/open-resource-discovery/.github/blob/main/CONTRIBUTING_USING_GENAI.md) in case you are using such tools.

## Issues and Planning

- We use GitHub issues to track bugs and enhancement requests.

- Please provide as much context as possible when you open an issue. The information you provide must be comprehensive enough to reproduce that issue for the assignee.

## Contributing Code

We love your input! We want to make contributing to the ORD Provider Server as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features

## TypeScript Coding Guidelines

We enforce code style rules using [ESLint](https://eslint.org/). Execute npm run lint to check your code for style issues.
You may also find an ESLint integration for your favorite IDE [here](https://eslint.org/docs/user-guide/integrations).

## Development Setup

### Prerequisites

- Node.js >= [22.8.0](package.json)
- NPM >= 10.8.2

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm ci

# Build the project
npm run build

# Optional: Create global link for CLI testing
npm link
```

### Development Environment

#### Using .env for Local Development

Copy the `.env.example` to `.env` file in your project root:

```bash
cp .env.example .env
```

Adapt the environment variables to your needs:

```env
# Base params
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
ORD_BASE_URL=http://127.0.0.1:8080
ORD_SOURCE_TYPE=local
ORD_DIRECTORY=./example
ORD_AUTH_TYPE=open

# Optional: Github configuration
GITHUB_TOKEN=
GITHUB_API_URL=https://api.github.com
GITHUB_REPOSITORY=owner/repo
GITHUB_BRANCH=main

# Optional: Basic auth users map
APP_USERS='{"admin":"secret"}'
```

> **Important**: Never commit the `.env` file to version control. It's already added to `.gitignore`.

### Development Scripts

```bash
# Start development server with hot reload
npm run dev

# Build the project
npm run build

# Run tests
npm run test

# Run tests with watch mode
npm run test:watch

# Run tests with coverage
npm run coverage

# Format code (ESLint + Prettier)
npm run format

# Run ESLint
npm run eslint

# Run Prettier
npm run prettier
```

### Dev examples

> All parameters can also be set in the .env file

1. **Local** (default: open)

```bash
 npm run dev -- -s local -d ./example
```

2. **Local** (basic auth)

```bash
 APP_USERS='{"admin":"secret"}' npm run dev -- -s local -d ./example --auth basic
```

### Project Structure

```
├── src/
│   ├── cli.ts                    # CLI implementation and command handling
│   ├── server.ts                 # Server setup and configuration
│   ├── middleware/               # Fastify middlewares
│   ├── model/                    # Type definitions and interfaces
│   ├── routes/                   # Route handlers
│   ├── services/                 # Business logic services
│   ├── util/                     # Utility functions
│   └── __tests__/                # Test files
├── example/                      # Test files for local development
└── reports/                      # Test and coverage reports
```

### Testing

Unit testing is based on the [Jest](https://jestjs.io/) testing-framework. You can run all tests using npm test (this is what our CI will do for all pull requests).

#### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run coverage
```

#### Test Structure

- Tests are located in `src/__tests__/`
- Use Jest for testing
- Follow the naming convention: `*.test.ts`
- Coverage reports are generated in `reports/jest-coverage/`

### Linting and Formatting

We use ESLint and Prettier for code quality and formatting:

```bash
# Run ESLint
npm run eslint

# Run Prettier
npm run prettier

# Run both
npm run format
```

Configuration files:

- `eslint.config.js` - ESLint configuration
- `jest.config.js`, `jest.setup.js` - Jest configuration
- `.prettierrc` - Prettier configuration

### Pre-commit Hooks

We use Husky for pre-commit hooks:

- ESLint check
- Prettier formatting

## Pull Request Process

1. Update the README.md with details of changes if needed
2. Update the CHANGELOG.md following semantic versioning
3. Ensure all tests pass and coverage meets requirements
4. Add appropriate documentation
5. The PR must be approved by at least one maintainer

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create a PR release/\<version\>
4. Merge into main
5. Create a release tag
6. Create a GitHub release

## Additional Notes

### Documentation

- Keep README.md up to date
- Document new features
- Comment complex code sections

### Versioning

We use [SemVer](http://semver.org/) for versioning.

### Branch Naming Convention

- feat/description
- fix/description
- chore/description
- release/version
