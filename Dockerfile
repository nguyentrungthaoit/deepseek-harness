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
# Sidebar wordmark and document title. Unset, the UI falls back to "DSH Local Build".
ENV DSH_CLIENT_BUILD_PROFILE=official
ENV DSH_CLIENT_TITLE="DeepSeek Harness"

RUN pnpm install --frozen-lockfile \
  && pnpm run build

FROM node:22.19-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/dsh-py \
  && /opt/dsh-py/bin/pip install --no-cache-dir \
    'python-docx==1.2.0' \
    'openpyxl==3.1.5' \
    'pypdf==6.19.0'

ENV PATH="/opt/dsh-py/bin:${PATH}" \
    NODE_ENV=production \
    DSH_HOME=/data/dsh \
    DSH_DOCKER_BIND_ALL=1

COPY --from=builder /app /app

RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /data/dsh /workspace

VOLUME ["/data/dsh"]
WORKDIR /workspace
EXPOSE 3080

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["web", "--no-open", "--port", "3080"]
