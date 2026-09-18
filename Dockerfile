# Production Dockerfile for EchoNote Backend on Google Cloud Run
# Stage 1: Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install system dependencies needed for native modules & ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for optimal layer caching
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Compile frontend and bundled backend server into dist/
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-slim AS runner

WORKDIR /app

# Ensure system-level FFmpeg and CA certs are present
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/firebase-blueprint.json ./firebase-blueprint.json
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder /app/firestore.rules ./firestore.rules

# Cloud Run injects PORT dynamically; server.ts reads process.env.PORT
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
