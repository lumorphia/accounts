# syntax=docker/dockerfile:1
ARG APP_VERSION=dev
FROM node:24.21.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/app/package.json apps/app/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# npm の認証は BuildKit の secret だけ。ARG や COPY で渡さない。
RUN --mount=type=cache,id=accounts-pnpm,target=/pnpm/store \
    --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN,required=true \
    env "pnpm_config_//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" pnpm install --frozen-lockfile

FROM deps AS build
ARG APP_VERSION
COPY . .
RUN APP_VERSION="$APP_VERSION" pnpm --filter @lumorphia-accounts/app build
RUN --mount=type=cache,id=accounts-pnpm,target=/pnpm/store \
    --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN,required=true \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules \
    && env "pnpm_config_//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" pnpm install --frozen-lockfile --prod --ignore-scripts
RUN node --input-type=module -e "await import('./apps/app/server/index.ts'); await import('./apps/app/server/character-worker.ts'); await import('./apps/app/server/account-worker.ts')"

FROM base AS app
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/app
EXPOSE 3100
CMD ["node", "--import", "./server/sentry.ts", "./server/index.ts"]
