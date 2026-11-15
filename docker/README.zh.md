# Docker 镜像（公司）

[English](README.md) | 中文

镜像：`nguyentrungthaoit/dsh:<tag>`

**公司电脑只需要 Docker。** 不安装 Node、pnpm、Python 或宿主机依赖库——全部 runtime 都在镜像里。

## Docker Compose（推荐）

```sh
copy docker\compose.env.example docker\compose.env
# sửa docker/compose.env: DEEPSEEK_API_KEY, DSH_WORKSPACE=...

docker compose --env-file docker/compose.env pull
docker compose --env-file docker/compose.env up -d
docker compose logs -f dsh
```

打开日志里带 `?token=` 的 URL。

### 公司电脑上的 workspace

Docker **看不到**整块硬盘。Agent 只在你挂载的目录里工作：

| 在 `docker/compose.env` 中 | 在容器 / UI 浏览中 |
|---|---|
| `DSH_WORKSPACE=D:/Workspaces/my-app` | 选择 `/workspace` |
| `DSH_WORKSPACE=D:/Workspaces` | 选择 `/workspace/my-app`（多个项目的父目录） |
| `DSH_HOST_EXTRA=E:/shared` | 选择 `/host-extra` |

改完**必须 recreate** 容器（更改挂载不会作用到正在运行的容器）：

```sh
docker compose --env-file docker/compose.env up -d --force-recreate
```

在 `/workspace` 里编辑的文件**就是宿主机上的真实文件**（bind mount），不是镜像里的副本。

浏览 UI 从 `HOME=/workspace` 打开（已在 compose 里配置）。recreate 之后硬刷新页面（Ctrl+Shift+R）。

**不要**在 workspace 目录的 `.env` 里设置 `DSH_*` 变量——`dsh` 会拒绝 project `.env` 中的 bootstrap-only names。请使用 `docker/compose.env`（通过 Compose 注入的进程环境变量）。

本地构建（允许的机器）：

```sh
# trong docker/compose.env set DSH_CLIENT_COMMIT_HASH từ: git rev-parse HEAD
docker compose --env-file docker/compose.env build
docker compose --env-file docker/compose.env up -d
```

Headless 单次任务：

```sh
docker compose --env-file docker/compose.env run --rm dsh --profile headless "summarize this repository"
```

停止：

```sh
docker compose --env-file docker/compose.env down
```

文件：[`docker-compose.yml`](../docker-compose.yml)，环境变量示例：[`compose.env.example`](compose.env.example)。

## 在公司使用（只需 Docker）

```sh
docker pull nguyentrungthaoit/dsh:0.2.1-alpha.10
```

### Web UI

```sh
docker run --rm -p 3080:3080 --shm-size=1g \
  -e DEEPSEEK_API_KEY=sk-... \
  -v dsh-home:/data/dsh \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.10
```

打开 `http://127.0.0.1:3080`。如果通过公司 hostname 访问：

```sh
... nguyentrungthaoit/dsh:0.2.1-alpha.10 web --no-open --port 3080 --trusted-host app.company.local:3080
```

### Headless（单个任务）

```sh
docker run --rm \
  -e DEEPSEEK_API_KEY=sk-... \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.10 \
  --profile headless "summarize this repository"
```

### 密钥与数据

- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` 在运行时通过 `-e` 或 `--env-file` 传入——不要把 `.env` 打进镜像。
- Session/设置：卷 `/data/dsh`（`DSH_HOME`）。
- Workspace：把项目挂载到 `/workspace`。

默认 Web 在容器内绑定 `0.0.0.0`（这样 `-p` 才能工作）。关闭：`-e DSH_DOCKER_BIND_ALL=0`。

### Ollama / 宿主机上的模型

在容器里，`127.0.0.1` 是容器自己——不是 Windows 宿主机。自定义 provider 的 base URL 使用：

```text
http://host.docker.internal:11434/v1
```

（Docker Desktop Windows/Mac。不要使用 `http://127.0.0.1:11434/v1`。）

### Java 与 Maven

镜像内置 JDK 21 和 JDK 8（Temurin）以及 Maven 3.9。容器访问不了 registry，因此 Maven 从本地仓库 `/m2/repository` 读取依赖，默认离线运行（`-o`）。

复用宿主机已下载的依赖：在 `docker/compose.env` 中把 `DSH_MAVEN_REPO` 指向宿主机的仓库目录（包含 `com/`、`org/` 等的目录；默认是 `.m2/repository`，若改过则是 `settings.xml` 中 `<localRepository>` 的路径），然后重建容器：

```sh
DSH_MAVEN_REPO=C:/Users/<you>/.m2/repository
```

该目录中必须已有依赖，即项目曾在宿主机上用 Maven 构建过（`mvn -DskipTests package` 或 `mvn dependency:go-offline`）。项目新增依赖时，在宿主机上构建一次下载下来，容器立即可见。宿主机的 `settings.xml` 不会被使用；镜像已配置好本地仓库。出现 `Cannot access ... in offline mode` 表示该构件（通常是插件）还不在宿主机的仓库中。

agent 在沙箱中运行的命令对 `/m2` 只读；离线构建和测试可以运行，而 `mvn install`（写入 `/m2`）需要允许在沙箱外运行。不设置 `DSH_MAVEN_REPO` 时，`/m2/repository` 是容器自己的 `dsh-m2` 卷。如果容器能访问 Maven 仓库（通过代理或 Nexus），在 `docker/compose.env` 中加一行 `MAVEN_ARGS=`（留空），让 Maven 在线下载。

JDK 21 是默认版本（`JAVA_HOME`、`java`、`mvn`）。Java 8 项目可以用以下任一方式使用 JDK 8：

- 按命令用 JDK 8 运行 Maven：`JAVA_HOME=$JAVA_HOME_8 mvn -DskipTests package`。项目使用无法在 Java 21 上运行的旧插件时需要这种方式。
- Maven 仍运行在 JDK 21 上，由 `maven-toolchains-plugin` 在编译和测试时选择 JDK 8：镜像已在 `/opt/maven/conf/toolchains.xml` 中声明两个 JDK（version `1.8` 和 `21`，vendor `temurin`）。

变量 `JAVA_HOME_8` 和 `JAVA_HOME_21` 分别指向 `/opt/java/jdk8` 和 `/opt/java/jdk21`。镜像不包含 JDK 25。

### 浏览器（Playwright）

镜像在构建时已安装 Chromium，有两种用法：

- **agent 的浏览器工具**：在 Web 侧边栏打开 **插件**，启用 **浏览器工具**（Bundle [`browser-use-bundle`](../packages/experimental/browser-use-bundle/README.zh.md)）；只需启用一次，状态保存在 `dsh-home` 卷中。新建或重新打开的 Session 会带上 Playwright MCP 工具，每个 Session 一个独立的 headless Chromium，不保存 profile。它是 experimental 包，因此不在默认 preset 中。镜像中该 Bundle 使用 `DSH_BROWSER_CHROMIUM` 启动器。
- **脚本**：默认 venv 中带有 Python 版 Playwright，agent 可以运行 `python3 script.py`，使用 `from playwright.sync_api import sync_playwright`。

容器以 root 运行，因此 Chromium 必须带 `--no-sandbox` 运行。浏览器工具已经通过启动器 `/usr/local/bin/dsh-chromium` 启动；Python 脚本也能运行，因为 Playwright 默认已关闭沙箱。Compose 设置了 `shm_size: 1gb`，因为 Docker 默认的 64 MB 会让 Chromium 崩溃；使用 `docker run` 时请加 `--shm-size=1g`。能打开哪些页面取决于容器的网络：要让 agent 访问内部应用，该主机必须能通过代理（Squid allowlist）。关闭浏览器工具：在插件管理页禁用该 Bundle。

### Java 代码导航（LSP）

Web preset `standard`、`cordis`、`ptc` 在存在 `DSH_JDTLS` 变量时（镜像已预设，指向 Eclipse JDT Language Server 的启动器 `/usr/local/bin/dsh-jdtls`）启用 `lsp` 工具。agent 用它查找 `.java` 文件的定义、所有引用、实现以及 hover 信息，比 grep 更准确。

jdtls 按镜像的离线配置读取 Maven，使用同一个 `/m2/repository`。在一个项目上的首次查询需要 jdtls 导入项目，可能耗时几分钟（工具超时为 5 分钟）；之后会很快。索引位于容器的 `/var/cache/dsh-jdtls`，不写入 workspace，重建容器后丢失。jdtls 运行在 JDK 21 上；声明 Java 8 的项目（`maven.compiler.source` 1.8）使用指向 JDK 8 的 `JavaSE-1.8` runtime 构建。jdtls 带 Lombok 1.18.48（javaagent）运行，因此使用 Lombok 的项目不会在生成的构造器、getter 或 builder 处报假错误。每个打开的项目堆内存上限为 2 GB。关闭：在 `docker/compose.env` 中设置 `DSH_JDTLS=`（留空）。

### 数据库（Oracle、PostgreSQL）

- PostgreSQL：`psql`（Debian 12 的客户端版本）。
- Oracle：SQLcl，命令为 `sql`，运行在内置的 JDK 21 上。例如：`sql -S user/password@//db-host:1521/SERVICE`。

容器必须能访问数据库的主机和端口。建议使用只读的开发库账号。dsh 会从 agent 的命令中过滤所有名称包含 `KEY`、`PASSWORD`、`SECRET` 或 `TOKEN` 的环境变量，因此 `DB_PASSWORD` 无法传到 `sql`/`psql`；若要让 agent 自行连接，请在 `docker/compose.env` 中用其他名称的变量保存连接串，例如 `DEV_ORACLE_URL=user/pass@//db-host:1521/SERVICE` 或 `DEV_PG_URL=postgresql://user:pass@db-host:5432/app`，然后运行 `sql -S "$DEV_ORACLE_URL"` 或 `psql "$DEV_PG_URL"`。

### 通过 SSH 使用 Git

镜像包含 `openssh-client` 和 `git-lfs`。把 `DSH_SSH_DIR` 指向宿主机上包含私钥、`config` 和 `known_hosts` 的目录；entrypoint 会把它复制到 `/root/.ssh` 并设为 600 权限（直接从 Windows 挂载的密钥显示为 0777，ssh 会拒绝）。agent 能使用这把密钥，因此建议使用单独的 deploy key，而不是个人密钥。`known_hosts` 必须已包含 Git 主机，因为沙箱中的命令无法写入它。

### 其他命令行工具

`xmllint`（读取和校验 `pom.xml`）、`yq`（YAML/XML/properties，例如 `application.yml`）、`tree`。

### 通过 Nexus 使用 npm 和 pip

容器无法访问 npm 和 PyPI。如果公司有 Nexus，在 `docker/compose.env` 中加入：

```sh
NPM_CONFIG_REGISTRY=https://nexus.company.local/repository/npm-group/
PIP_INDEX_URL=https://nexus.company.local/repository/pypi-group/simple
```

### 选择 workspace（目录选择器）

Docker 绑定 `0.0.0.0`，因此 Host 使用 **browse**（浏览容器内目录），不会打开 Windows 的文件夹对话框。这是预期设计——原生操作系统选择器不会在容器内运行。

1. 把宿主机项目挂载进容器：`-v C:\path\to\project:/workspace`
2. 在 UI 中选择 workspace → 应用内对话框 → 打开 `/workspace`
3. 如果仍看到错误 `needs the native capability; ... serves "browse"`：硬刷新（Ctrl+Shift+R）从 Docker 容器 token URL 打开的 Web 页面（不要和本地 `pnpm dsh web` 搞混）

## 构建并推送（有权限 / 未被策略拦截的机器）

在公司电脑之外做一次（或用 CI），同事之后只需 `docker pull`。

```sh
docker build \
  --build-arg DSH_CLIENT_COMMIT_HASH="$(git rev-parse HEAD)" \
  -t nguyentrungthaoit/dsh:0.2.1-alpha.10 \
  -t nguyentrungthaoit/dsh:latest \
  .

docker login
docker push nguyentrungthaoit/dsh:0.2.1-alpha.10
docker push nguyentrungthaoit/dsh:latest
```

`DSH_CLIENT_COMMIT_HASH` 是 7–40 位十六进制 commit（Docker context 不包含 `.git`）。

出口代理（Squid）镜像基于 Ubuntu 24.04 软件包构建，因为 `ubuntu/squid:latest` 标签已不再重建，缺少 2026 年的 Squid 安全修复。它可直接替换 `ubuntu/squid`：同样的 3128 端口、同样的 `/etc/squid/squid.conf`，日志输出到 stdout。请定期重建以获取新的修复：

```sh
docker build -t nguyentrungthaoit/dsh-squid:6.14 docker/squid
docker push nguyentrungthaoit/dsh-squid:6.14
```

## 镜像里的 shell

容器带有 `bash`、`git`、`curl`、`jq`、`rg`（ripgrep）、`make`、`sqlite3`、`zip`/`unzip`、`xz`、`file`、`less`、`ps` 和 `tini`（PID 1，转发 SIGTERM 并回收子进程）。`PATH` 上的 `python3` 和 `pip` 是 venv `/opt/dsh-py`，已安装 `python-docx` 1.2.0、`openpyxl` 3.1.5、`pypdf` 6.19.0、`pandas` 2.3.3、`matplotlib` 3.10.7、`python-pptx` 1.0.2 和 `XlsxWriter` 3.2.9。Agent 在需要读取 `.docx`、`.xlsx` 或 PDF 文本时调用 `python3`。

公司网络不允许在运行时下载软件包，因此 agent 需要的工具都预装在镜像里。镜像安装了 Noto（完整的越南语声调）、DejaVu、Liberation（与 Arial/Times/Courier 字宽一致）和 Carlito/Caladea（替代 Calibri/Cambria）字体。Web 中的 Office 预览和 `matplotlib` 图表使用这些字体。

镜像带有 `HEALTHCHECK`：容器内 3080 端口的 Web 有响应时，`docker ps` 显示 `healthy`。镜像设置 `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime`（`runtime.json` 记录该 venv 的版本），因此 Web 预设挂载 `office-docx`、`office-xlsx`、`office-pptx` skill 和 `load_workspace_dependencies` 工具：模型用这个 venv 创建、编辑和检查 Word、Excel、PowerPoint 文件，并通过 LibreOffice Kit 导出 PDF。设置 `DSH_PRIMARY_RUNTIME=`（空值）即可关闭。装进 `/opt/dsh-py` 的 `pip install` 会在重建容器时消失；建在 `/workspace` 下的 venv 位于宿主机挂载上。

## 自定义 skill

挂载 skill 目录的说明见 [custom skill 配置](../docs/user/guide/custom-skills.vi.md)。

## 运维说明

Web UI 控制 agent（容器内的 shell/filesystem）。只在内网/VPN 上发布端口；如果暴露到外网，请放在带认证的反向代理后面。

运行不可信文件的工具（如 `read_document`）总是在沙箱中运行。镜像安装了 `bubblewrap`（Linux 上的首选 runner），并预先构建了 `landlock-run` 启动器（备用 runner，需要内核启用 Landlock）。没有可用的 runner 时，工具会报告 `SANDBOX_UNAVAILABLE`，而不是在沙箱外运行。在 Docker Desktop（WSL2）上，两者在默认 seccomp 下都能运行；那里的 Landlock 只达到旧版 ABI（`partially enforced`）。容器使用 `user: "1000:1000"`、`cap_drop: [ALL]` 和 `no-new-privileges:true` 时，`bubblewrap` 仍能完整运行。
