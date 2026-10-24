# syntax=docker/dockerfile:1

FROM node:22.19-bookworm AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates musl-tools \
  && rm -rf /var/lib/apt/lists/*

COPY . .

# Build embeds this in client artifacts; .git is not in the image context.
ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}
# Sidebar wordmark and document title. Unset, the UI falls back to "DSH Local Build".
ENV DSH_CLIENT_BUILD_PROFILE=official
ENV DSH_CLIENT_TITLE="Devz Harness"

# `pnpm run build` builds only the host Node-API addon. The full native build also
# produces the static musl `landlock-run` launcher, the sandbox fallback when the
# runtime lacks bubblewrap; the launcher is not tracked in git.
RUN pnpm install --frozen-lockfile \
  && pnpm run build \
  && pnpm exec tsx native/system/scripts/build.ts

FROM node:22.19-bookworm-slim AS runtime

WORKDIR /app

# Company deployments have no package-registry egress, so every tool the agent
# needs ships here. Fonts serve the WASM Office preview and matplotlib: Noto
# covers Vietnamese, Liberation/Carlito/Caladea are metric-compatible with
# Arial/Times/Courier and Calibri/Cambria so converted layouts keep their shape.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    file \
    fonts-crosextra-caladea \
    fonts-crosextra-carlito \
    fonts-dejavu-core \
    fonts-liberation2 \
    fonts-noto-core \
    fontconfig \
    git \
    jq \
    less \
    make \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    sqlite3 \
    tini \
    unzip \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f \
  && python3 -m venv /opt/dsh-py \
  && /opt/dsh-py/bin/pip install --no-cache-dir \
    'python-docx==1.2.0' \
    'openpyxl==3.1.5' \
    'pypdf==6.19.0' \
    'pandas==2.3.3' \
    'matplotlib==3.10.7'

# HOME is the mounted workspace in compose; keep matplotlib's cache out of it.
ENV PATH="/opt/dsh-py/bin:${PATH}" \
    MPLCONFIGDIR=/tmp/matplotlib \
    NODE_ENV=production \
    DSH_HOME=/data/dsh \
    DSH_DOCKER_BIND_ALL=1

COPY --from=builder /app /app

RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /data/dsh /workspace

VOLUME ["/data/dsh"]
WORKDIR /workspace
EXPOSE 3080

# Any HTTP answer (the unauthenticated index returns 401) means the Web server is up.
# --noproxy keeps the probe off the company egress proxy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -so /dev/null --noproxy '*' http://127.0.0.1:3080/ || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["web", "--no-open", "--port", "3080"]
