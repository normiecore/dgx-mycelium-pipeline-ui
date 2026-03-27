# =============================================================================
# Knowledge Harvester Pipeline -- Production Dockerfile
# Multi-stage build: compile TS + frontend, then slim runtime image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build backend (TypeScript -> JS)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build-backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Build frontend (Vite/React)
#   vite.config.ts has outDir: '../frontend-dist' so output lands at /app/frontend-dist
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build-frontend
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 3: Production-only dependencies
#   better-sqlite3 has native bindings -- rebuild against the runtime OS
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 4: Runtime image
# ---------------------------------------------------------------------------
FROM node:22-alpine

# curl for health checks, tini for proper PID 1 signal handling
RUN apk add --no-cache curl tini

# Non-root user
RUN addgroup -S pipeline && adduser -S pipeline -G pipeline

WORKDIR /app

# Production node_modules (no devDependencies)
COPY --from=prod-deps /app/node_modules ./node_modules

# Compiled backend JS
COPY --from=build-backend /app/dist ./dist

# Built frontend assets (served by @fastify/static from ./frontend-dist)
COPY --from=build-frontend /app/frontend-dist ./frontend-dist

# Runtime assets
COPY package.json ./
COPY prompts/ ./prompts/

# Data directory for SQLite databases
RUN mkdir -p /app/data && chown -R pipeline:pipeline /app

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["/sbin/tini", "--"]
USER pipeline

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "dist/src/main.js"]
