FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
# Force development so devDependencies (typescript, @types/*) are installed for build
ENV NODE_ENV=development
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# CACHEBUST: pass --build-arg CACHEBUST=$(date +%s) to force full rebuild (e.g. in Coolify Build Args)
# Updated 2026-03-31 01:30 UTC - Force rebuild for USDT UI disable and wallet address fixes
ARG CACHEBUST=3
RUN echo "Build cache bust: $CACHEBUST"
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED 1

# Use production for next build - avoids "non-standard NODE_ENV" and Html import false errors
ENV NODE_ENV=production
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Include create-admin script for one-off admin creation from Coolify terminal
COPY --from=builder /app/scripts ./scripts
RUN npm install --no-save mongoose bcryptjs dotenv && chown -R nextjs:nodejs scripts node_modules

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["node", "server.js"]

