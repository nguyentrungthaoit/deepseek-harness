# Docker image (công ty)

English | [中文](README.zh.md)

Image: `nguyentrungthaoit/dsh:<tag>`

**Máy công ty chỉ cần Docker.** Không cài Node, pnpm, Python hay thư viện host — mọi runtime nằm trong image.

## Docker Compose (khuyên dùng)

```sh
copy docker\compose.env.example docker\compose.env
# sửa docker/compose.env: DEEPSEEK_API_KEY, DSH_WORKSPACE=...

docker compose --env-file docker/compose.env pull
docker compose --env-file docker/compose.env up -d
docker compose logs -f dsh
```

Mở URL có `?token=` trong log.

### Workspace trên máy công ty

Docker **không** thấy toàn bộ ổ cứng. Agent chỉ làm việc trên thư mục bạn mount:

| Trong `docker/compose.env` | Trong container / UI browse |
|---|---|
| `DSH_WORKSPACE=D:/Workspaces/my-app` | chọn `/workspace` |
| `DSH_WORKSPACE=D:/Workspaces` | chọn `/workspace/my-app` (parent nhiều project) |
| `DSH_HOST_EXTRA=E:/shared` | chọn `/host-extra` |

Sửa xong **phải recreate** container (đổi mount không áp vào container đang chạy):

```sh
docker compose --env-file docker/compose.env up -d --force-recreate
```

File edit trong `/workspace` **là file thật trên máy host** (bind mount), không phải bản copy trong image.

Browse UI mở tại `HOME=/workspace` (đã cấu hình trong compose). Hard refresh trang (Ctrl+Shift+R) sau khi recreate.

**Không** đặt biến `DSH_*` trong `.env` của thư mục workspace — `dsh` từ chối bootstrap-only names trong project `.env`. Dùng `docker/compose.env` (process env qua Compose).

Build local (máy được phép):

```sh
# trong docker/compose.env set DSH_CLIENT_COMMIT_HASH từ: git rev-parse HEAD
docker compose --env-file docker/compose.env build
docker compose --env-file docker/compose.env up -d
```

Headless one-shot:

```sh
docker compose --env-file docker/compose.env run --rm dsh --profile headless "summarize this repository"
```

Stop:

```sh
docker compose --env-file docker/compose.env down
```

File: [`docker-compose.yml`](../docker-compose.yml), mẫu env: [`compose.env.example`](compose.env.example).

## Dùng tại công ty (chỉ Docker)

```sh
docker pull nguyentrungthaoit/dsh:0.2.1-alpha.5
```

### Web UI

```sh
docker run --rm -p 3080:3080 \
  -e DEEPSEEK_API_KEY=sk-... \
  -v dsh-home:/data/dsh \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.5
```

Mở `http://127.0.0.1:3080`. Nếu truy cập qua hostname công ty:

```sh
... nguyentrungthaoit/dsh:0.2.1-alpha.5 web --no-open --port 3080 --trusted-host app.company.local:3080
```

### Headless (một task)

```sh
docker run --rm \
  -e DEEPSEEK_API_KEY=sk-... \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.5 \
  --profile headless "summarize this repository"
```

### Secrets và data

- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` qua `-e` hoặc `--env-file` lúc run — không bake `.env` vào image.
- Session/settings: volume `/data/dsh` (`DSH_HOME`).
- Workspace: mount project vào `/workspace`.

Mặc định Web bind `0.0.0.0` trong container (để `-p` hoạt động). Tắt: `-e DSH_DOCKER_BIND_ALL=0`.

### Ollama / model trên máy host

Trong container, `127.0.0.1` là chính container — không phải máy Windows. Custom provider base URL dùng:

```text
http://host.docker.internal:11434/v1
```

(Docker Desktop Windows/Mac. Không dùng `http://127.0.0.1:11434/v1`.)

### Chọn workspace (directory picker)

Docker bind `0.0.0.0` nên Host dùng **browse** (duyệt thư mục trong container), không mở hộp thoại thư mục của Windows. Đó là đúng thiết kế — native OS picker không chạy trong container.

1. Mount project host vào container: `-v C:\path\to\project:/workspace`
2. Trong UI chọn workspace → hộp thoại in-app → mở `/workspace`
3. Nếu vẫn thấy lỗi `needs the native capability; ... serves "browse"`: hard refresh (Ctrl+Shift+R) trang Web mở từ URL token của container Docker (đừng lẫn với `pnpm dsh web` local)

## Build & push (máy có quyền / không bị policy chặn)

Làm một lần ngoài máy công ty (hoặc CI), rồi đồng nghiệp chỉ `docker pull`.

```sh
docker build \
  --build-arg DSH_CLIENT_COMMIT_HASH="$(git rev-parse HEAD)" \
  -t nguyentrungthaoit/dsh:0.2.1-alpha.5 \
  -t nguyentrungthaoit/dsh:latest \
  .

docker login
docker push nguyentrungthaoit/dsh:0.2.1-alpha.5
docker push nguyentrungthaoit/dsh:latest
```

`DSH_CLIENT_COMMIT_HASH` là commit 7–40 hex (context Docker không gồm `.git`).

## Shell trong image

Container có `bash`, `git`, `curl` và `tini` (PID 1, chuyển SIGTERM và thu process con). `python3` và `pip` trên `PATH` là venv `/opt/dsh-py`, đã cài `python-docx` 1.2.0, `openpyxl` 3.1.5 và `pypdf` 6.19.0. Agent gọi `python3` khi cần đọc `.docx`, `.xlsx` hoặc chữ trong PDF. Web không gắn skill Office của Desktop, nên model không được nhắc dùng các thư viện này. `pip install` vào `/opt/dsh-py` mất khi tạo lại container; venv tạo dưới `/workspace` nằm trên mount của máy host.

## Custom skill

Cách gắn thư mục skill nằm ở [cấu hình custom skill](../docs/user/guide/custom-skills.vi.md).

## Lưu ý vận hành

Web UI điều khiển agent (shell/filesystem trong container). Chỉ publish port trên mạng nội bộ/VPN; nếu expose ra ngoài hãy đặt reverse proxy có auth.
