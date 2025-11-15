FROM node:24.11.1-alpine AS builder

ARG GIT_COMMIT_HASH=unknown
ENV ORD_PROVIDER_SERVER_VERSION_HASH=${GIT_COMMIT_HASH}

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

COPY package*.json tsconfig*.json ./

RUN npm ci

COPY ./src ./src
COPY ./public ./public

RUN npm run build \
    && npm prune --production \
    && chown -R nodejs:nodejs /app

FROM node:24.11.1-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/public ./public

# Set environment
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Make the application executable
RUN chmod +x ./dist/src/cli.js

EXPOSE 8080

ENTRYPOINT ["/app/dist/src/cli.js"]
