FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile \
  && AUTH_MODE=disabled \
     ALLOW_AUTH_DISABLED=true \
     LOCAL_OWNER_EMAIL=build@localhost \
     DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
     pnpm build \
  && mkdir -p /app/.data/files \
  && chown -R node:node /app

ENV NODE_ENV=production
USER node
EXPOSE 3000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
