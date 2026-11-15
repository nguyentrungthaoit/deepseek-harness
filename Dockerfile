# syntax=docker/dockerfile:1

FROM node:22.23.4-bookworm AS builder

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

# Java toolchain stages: the runtime copies the JDKs and Maven out of the
# official images, so no package registry is needed at build or run time.
FROM eclipse-temurin:21-jdk AS jdk
FROM eclipse-temurin:8-jdk AS jdk8
FROM maven:3.9-eclipse-temurin-21 AS maven
FROM mikefarah/yq:4.54.1 AS yq

# Pinned third-party archives, verified by checksum and bind-mounted into the
# runtime install step.
FROM scratch AS downloads
ADD --checksum=sha256:f3f188ae06f17eb181f77ae0be54f2ae8c165e52056a7cb7401a974cace9e5f2 \
  https://download.oracle.com/otn_software/java/sqldeveloper/sqlcl-26.3.1.301.1413.zip /sqlcl.zip
ADD --checksum=sha256:338e7e73d61836651ba2453919a0d34fa763eb4e7c03342092309bffb8934c64 \
  https://download.eclipse.org/jdtls/milestones/1.61.0/jdt-language-server-1.61.0-202609031315.tar.gz /jdtls.tar.gz
ADD --checksum=sha256:85477a4655ebb2c074a9099cfb749be454449fee564d4282610df1b85f7c508b \
  https://repo1.maven.org/maven2/org/projectlombok/lombok/1.18.48/lombok-1.18.48.jar /lombok.jar

FROM node:22.23.4-bookworm-slim AS runtime

WORKDIR /app

# Company deployments have no package-registry egress, so every tool the agent
# needs ships here. Fonts serve the WASM Office preview and matplotlib: Noto
# covers Vietnamese, Liberation/Carlito/Caladea are metric-compatible with
# Arial/Times/Courier and Calibri/Cambria so converted layouts keep their shape.
# `upgrade` pulls Debian security fixes the base image predates.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
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
    git-lfs \
    jq \
    less \
    libxml2-utils \
    make \
    openssh-client \
    postgresql-client \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    sqlite3 \
    tini \
    tree \
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
    'matplotlib==3.10.7' \
    'python-pptx==1.0.2' \
    'XlsxWriter==3.2.9' \
    'playwright==1.64.1'

# Chromium for Playwright scripts and the optional browser-use bundle. Browsers
# and their system libraries install at build time (no egress at run time).
# The container runs as root, where Chromium refuses its own sandbox, so the
# browser provider launches it through a wrapper that adds --no-sandbox.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN /opt/dsh-py/bin/playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && chrome="$(find /opt/ms-playwright -path '*/chromium-*/chrome-linux*/chrome' -type f | head -n 1)" \
  && test -x "$chrome" \
  && printf '#!/bin/sh\nexec %s --no-sandbox "$@"\n' "$chrome" > /usr/local/bin/dsh-chromium \
  && chmod 755 /usr/local/bin/dsh-chromium \
  && chmod -R a+rX /opt/ms-playwright

# The Web presets mount the Office skills and load_workspace_dependencies when
# DSH_PRIMARY_RUNTIME names a payload: runtime.json plus dependencies/python.
# The venv is that Python; the manifest records its version and distributions.
RUN mkdir -p /opt/dsh-runtime/dependencies \
  && ln -s /opt/dsh-py /opt/dsh-runtime/dependencies/python
RUN /opt/dsh-py/bin/python3 <<'PY'
import importlib.metadata, json, platform
arch = {'x86_64': 'x64', 'aarch64': 'arm64'}[platform.machine()]
packages = {d.metadata['Name']: d.version for d in importlib.metadata.distributions()}
manifest = {
    'desktopVersion': 'docker', 'platform': 'linux', 'arch': arch,
    'python': platform.python_version(), 'pythonPackages': dict(sorted(packages.items())),
}
with open('/opt/dsh-runtime/runtime.json', 'w') as f:
    json.dump(manifest, f, indent=2)
PY

# JDK 21 (default), JDK 8 and Maven for the company's Java projects. The image
# has no registry egress, so Maven resolves from a local repository at
# /m2/repository: compose mounts the host's repository there (DSH_MAVEN_REPO).
# MAVEN_ARGS defaults to offline,
# and the dummy tracking file lets Maven use artifacts the host cached through
# a mirror whose repository id differs from the project's (e.g. a company
# Nexus). Set MAVEN_ARGS= in docker/compose.env to resolve online again.
# JDK 8 is JAVA_HOME_8: switch per command (JAVA_HOME=$JAVA_HOME_8 mvn ...) or
# through maven-toolchains-plugin, which reads the global toolchains.xml below.
COPY --from=jdk /opt/java/openjdk /opt/java/jdk21
COPY --from=jdk8 /opt/java/openjdk /opt/java/jdk8
COPY --from=maven /usr/share/maven /opt/maven
RUN mkdir -p /m2/repository \
  && cat > /opt/maven/conf/settings.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.2.0 https://maven.apache.org/xsd/settings-1.2.0.xsd">
  <localRepository>/m2/repository</localRepository>
</settings>
XML
COPY <<'XML' /opt/maven/conf/toolchains.xml
<?xml version="1.0" encoding="UTF-8"?>
<toolchains xmlns="http://maven.apache.org/TOOLCHAINS/1.1.0"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://maven.apache.org/TOOLCHAINS/1.1.0 https://maven.apache.org/xsd/toolchains-1.1.0.xsd">
  <toolchain>
    <type>jdk</type>
    <provides><version>21</version><vendor>temurin</vendor></provides>
    <configuration><jdkHome>/opt/java/jdk21</jdkHome></configuration>
  </toolchain>
  <toolchain>
    <type>jdk</type>
    <provides><version>1.8</version><vendor>temurin</vendor></provides>
    <configuration><jdkHome>/opt/java/jdk8</jdkHome></configuration>
  </toolchain>
</toolchains>
XML

# yq (YAML/XML/properties editing, e.g. Spring application.yml).
COPY --from=yq /usr/bin/yq /usr/local/bin/yq

# Oracle SQLcl (`sql`) for Oracle databases; psql comes from postgresql-client.
# Eclipse JDT Language Server for the Web presets' `lsp` tool. 1.61.0 is the
# last jdtls whose platform runs on Java 21 (1.62+ needs a Java 25 runtime);
# the wrapper pins JAVA_HOME to JDK 21 for jdtls itself, and the presets
# register JDK 8 as the JavaSE-1.8 runtime for Java 8 projects.
# The archives come from the downloads stage through a bind mount, so they
# never land in an image layer. The wrapper keeps jdtls state (index per
# project, OSGi configuration, user.home) out of the mounted workspace, caps
# the heap, and reuses the Maven offline settings. Lombok runs as a javaagent
# so jdtls sees generated constructors, getters and builders instead of
# reporting false errors in Lombok projects.
RUN --mount=type=bind,from=downloads,target=/dl \
  unzip -q /dl/sqlcl.zip -d /opt \
  && chmod 755 /opt/sqlcl/bin/sql \
  && ln -s /opt/sqlcl/bin/sql /usr/local/bin/sql \
  && mkdir -p /opt/jdtls \
  && tar -xzf /dl/jdtls.tar.gz -C /opt/jdtls \
  && install -m 644 /dl/lombok.jar /opt/jdtls/lombok.jar
COPY --chmod=755 <<'SH' /usr/local/bin/dsh-jdtls
#!/bin/sh
base=/var/cache/dsh-jdtls
key=$(pwd | sha1sum | cut -c1-40)
mkdir -p "$base/home" "$base/data"
export JAVA_HOME=/opt/java/jdk21
exec /opt/dsh-py/bin/python3 /opt/jdtls/bin/jdtls \
  --jvm-arg=-Duser.home="$base/home" \
  --jvm-arg=-Xmx2G \
  --jvm-arg=-javaagent:/opt/jdtls/lombok.jar \
  --jvm-arg=-Daether.enhancedLocalRepository.trackingFilename=.dsh-no-tracking \
  -configuration "$base/config" \
  -data "$base/data/$key" \
  "$@"
SH

# HOME is the mounted workspace in compose; keep matplotlib's cache out of it.
ENV DSH_BROWSER_CHROMIUM=/usr/local/bin/dsh-chromium \
    DSH_JDTLS=/usr/local/bin/dsh-jdtls \
    JAVA_HOME=/opt/java/jdk21 \
    JAVA_HOME_21=/opt/java/jdk21 \
    JAVA_HOME_8=/opt/java/jdk8 \
    MAVEN_HOME=/opt/maven \
    MAVEN_ARGS="-o -Daether.enhancedLocalRepository.trackingFilename=.dsh-no-tracking" \
    PATH="/opt/java/jdk21/bin:/opt/maven/bin:/opt/dsh-py/bin:${PATH}" \
    DSH_PRIMARY_RUNTIME=/opt/dsh-runtime \
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
