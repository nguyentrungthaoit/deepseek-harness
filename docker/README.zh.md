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
docker pull nguyentrungthaoit/dsh:0.2.1-alpha.4
```

### Web UI

```sh
docker run --rm -p 3080:3080 \
  -e DEEPSEEK_API_KEY=sk-... \
  -v dsh-home:/data/dsh \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.4
```

打开 `http://127.0.0.1:3080`。如果通过公司 hostname 访问：

```sh
... nguyentrungthaoit/dsh:0.2.1-alpha.4 web --no-open --port 3080 --trusted-host app.company.local:3080
```

### Headless（单个任务）

```sh
docker run --rm \
  -e DEEPSEEK_API_KEY=sk-... \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.4 \
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
  -t nguyentrungthaoit/dsh:0.2.1-alpha.4 \
  -t nguyentrungthaoit/dsh:latest \
  .

docker login
docker push nguyentrungthaoit/dsh:0.2.1-alpha.4
docker push nguyentrungthaoit/dsh:latest
```

`DSH_CLIENT_COMMIT_HASH` 是 7–40 位十六进制 commit（Docker context 不包含 `.git`）。

## 镜像里的 shell

容器带有 `bash`、`git`、`curl` 和 `tini`（PID 1，转发 SIGTERM 并回收子进程）。`PATH` 上的 `python3` 和 `pip` 是 venv `/opt/dsh-py`，已安装 `python-docx` 1.2.0、`openpyxl` 3.1.5 和 `pypdf` 6.19.0。Agent 在需要读取 `.docx`、`.xlsx` 或 PDF 文本时调用 `python3`。Web 不挂载 Desktop 的 Office skill，因此模型不会被提示使用这些库。装进 `/opt/dsh-py` 的 `pip install` 会在重建容器时消失；建在 `/workspace` 下的 venv 位于宿主机挂载上。

## 自定义 skill

挂载 skill 目录的说明见 [custom skill 配置](../docs/user/guide/custom-skills.vi.md)。

## 运维说明

Web UI 控制 agent（容器内的 shell/filesystem）。只在内网/VPN 上发布端口；如果暴露到外网，请放在带认证的反向代理后面。
