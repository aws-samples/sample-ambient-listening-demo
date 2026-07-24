# Stage 1: Install production dependencies
FROM public.ecr.aws/docker/library/node:20.18.0-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Build the Next.js application
FROM public.ecr.aws/docker/library/node:20.18.0-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Production runtime
FROM public.ecr.aws/docker/library/node:20.18.0-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy the WebSocket-enabled entrypoint
COPY start-server.js ./start-server.js

# Copy production node_modules (for ws and AWS SDK used by start-server.js)
COPY --from=deps /app/node_modules ./node_modules

# Create cache directory
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Use start-server.js which patches the Next.js server to add WebSocket on /ws
CMD ["node", "start-server.js"]
