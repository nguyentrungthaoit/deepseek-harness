# syntax=docker/dockerfile:1

FROM node:22.19-bookworm AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY . .

# Build embeds this in client artifacts; .git is not in the image context.
ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

RUN pnpm install --frozen-lockfile \
  && pnpm run build

FROM node:22.19-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git bash \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DSH_HOME=/data/dsh \
    DSH_DOCKER_BIND_ALL=1

COPY --from=builder /app /app

RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /data/dsh /workspace

VOLUME ["/data/dsh"]
WORKDIR /workspace
EXPOSE 3080

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web", "--no-open", "--port", "3080"]
