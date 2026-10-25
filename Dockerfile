# ==============================================================================
# EchoNote Production Cloud Run Multi-Stage Dockerfile
# ==============================================================================
# Target: Google Cloud Run (Container runtime, Linux x86_64, non-root user)
# Base: Node.js 22 LTS Bookworm (Debian slim)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Application Bundles (Vite frontend + esbuild server bundle)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy full application source for compilation
COPY . .

# Build Vite client SPA (into dist/) and bundle server (into dist/server.cjs)
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime Image
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Ensure curl is available for local container healthchecks (Cloud Run uses native HTTP probes)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only (including ffmpeg-static and firebase-admin)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled bundles and static distribution from builder stage
COPY --from=builder /app/dist ./dist

# Copy required runtime config and public assets
COPY public ./public
COPY firebase-applet-config.json ./

# Ensure ffmpeg-static binary has execute permissions
RUN if [ -d "node_modules/ffmpeg-static" ]; then chmod +x node_modules/ffmpeg-static/ffmpeg* 2>/dev/null || true; fi

# Run as non-root user node (UID 1000) for hardened container security
USER node

# Expose container port (Cloud Run sets PORT=8080 or PORT=3000)
EXPOSE 3000

# Healthcheck for container runtimes that inspect Docker HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

# Start authoritative Express backend
CMD ["node", "dist/server.cjs"]
