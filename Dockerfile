# One image: the migrations, the web app (Next.js standalone server, :3000) and the background worker, started together by
# scripts/start.mjs. Published as ghcr.io/listicktv/listick; `docker build -t ghcr.io/listicktv/listick .` builds it from source.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 BETTER_AUTH_SECRET=build-time-only
RUN npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf node_modules/next node_modules/@next && npm cache clean --force

# the worker and the migrations run from the source with tsx; the web app from its standalone build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node src ./src
COPY --from=build --chown=node:node /app/.next/standalone ./web
COPY --from=build --chown=node:node /app/.next/static ./web/.next/static
COPY --from=build --chown=node:node /app/public ./web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "scripts/start.mjs"]
