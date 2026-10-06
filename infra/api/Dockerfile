# The API as a container, for any host that runs one. Build from the repo root:
#   docker build -f infra/api/Dockerfile -t ecosight-api .
FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable
WORKDIR /app

# Manifests first, so dependencies are reinstalled only when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# tsx runs the TypeScript directly, so dev dependencies are needed at runtime.
RUN pnpm install --frozen-lockfile --filter @atlas/api --prod=false

COPY apps/api apps/api
USER node
EXPOSE 4000
# The host supplies DATABASE_URL and, usually, PORT.
CMD ["pnpm", "--filter", "@atlas/api", "exec", "tsx", "src/server.ts"]
