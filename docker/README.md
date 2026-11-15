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

Mở `http://127.0.0.1:3080`. Nếu truy cập qua hostname công ty:

```sh
... nguyentrungthaoit/dsh:0.2.1-alpha.10 web --no-open --port 3080 --trusted-host app.company.local:3080
```

### Headless (một task)

```sh
docker run --rm \
  -e DEEPSEEK_API_KEY=sk-... \
  -v /path/to/project:/workspace \
  -w /workspace \
  nguyentrungthaoit/dsh:0.2.1-alpha.10 \
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

### Java và Maven

Image có sẵn JDK 21 và JDK 8 (Temurin) cùng Maven 3.9. Container không ra được registry, nên Maven đọc dependency từ local repository `/m2/repository`, mặc định chạy offline (`-o`).

Dùng lại dependency đã tải trên máy host: trỏ `DSH_MAVEN_REPO` tới thư mục repository của host (thư mục chứa `com/`, `org/`...; mặc định là `.m2/repository`, hoặc đường dẫn `<localRepository>` trong `settings.xml` nếu đã đổi) trong `docker/compose.env`, rồi recreate container:

```sh
DSH_MAVEN_REPO=C:/Users/<you>/.m2/repository
```

Thư mục đó phải đã có dependency, tức là project đã từng build bằng Maven trên host (`mvn -DskipTests package` hoặc `mvn dependency:go-offline`). Khi project thêm thư viện mới, build lại một lần trên host để tải về, container sẽ thấy ngay. `settings.xml` của host không được dùng; image đã cấu hình sẵn local repository. Lỗi `Cannot access ... in offline mode` nghĩa là artifact (thường là plugin) chưa có trong repository của host.

Command agent chạy trong sandbox chỉ đọc được `/m2`; build và test offline vẫn chạy, còn `mvn install` (ghi vào `/m2`) cần cho phép chạy ngoài sandbox. Không đặt `DSH_MAVEN_REPO` thì `/m2/repository` là volume `dsh-m2` riêng của container. Nếu container ra được Maven repo (qua proxy hoặc Nexus), thêm dòng `MAVEN_ARGS=` (để trống) vào `docker/compose.env` để Maven tải online.

JDK 21 là mặc định (`JAVA_HOME`, `java`, `mvn`). Project Java 8 dùng JDK 8 theo một trong hai cách:

- Chạy Maven bằng JDK 8 cho từng lệnh: `JAVA_HOME=$JAVA_HOME_8 mvn -DskipTests package`. Cần cách này khi project dùng plugin cũ không chạy được trên Java 21.
- Giữ Maven trên JDK 21 và để `maven-toolchains-plugin` chọn JDK 8 khi compile và test: image đã khai báo cả hai JDK trong `/opt/maven/conf/toolchains.xml` (version `1.8` và `21`, vendor `temurin`).

Biến `JAVA_HOME_8` và `JAVA_HOME_21` trỏ tới `/opt/java/jdk8` và `/opt/java/jdk21`. Image không có JDK 25.

### Trình duyệt (Playwright)

Image có Chromium cài sẵn lúc build, dùng được theo hai cách:

- **Browser tools của agent**: vào **Plugins** trên sidebar Web và bật **Browser tools** (bundle [`browser-use-bundle`](../packages/experimental/browser-use-bundle/README.md)); chỉ cần bật một lần, trạng thái lưu trong volume `dsh-home`. Session mới hoặc được mở lại sẽ có các tool Playwright MCP, mỗi Session một Chromium headless riêng, không lưu profile. Đây là gói experimental nên không có sẵn trong preset mặc định. Trong image, bundle dùng launcher `DSH_BROWSER_CHROMIUM`.
- **Script**: Playwright cho Python có trong venv mặc định, nên agent chạy được `python3 script.py` với `from playwright.sync_api import sync_playwright`.

Container chạy bằng root nên Chromium phải chạy với `--no-sandbox`. Browser tools đã đi qua launcher `/usr/local/bin/dsh-chromium`; script Python cũng chạy được vì Playwright mặc định đã tắt sandbox. Compose đặt `shm_size: 1gb` vì mức 64 MB mặc định của Docker làm Chromium crash; nếu dùng `docker run` thì thêm `--shm-size=1g`. Trang nào mở được tuỳ vào mạng của container: muốn agent vào app nội bộ thì host đó phải đi qua được proxy (Squid allowlist). Muốn tắt browser tools: tắt bundle trong Plugins.

### Điều hướng code Java (LSP)

Các preset Web `standard`, `cordis`, `ptc` bật tool `lsp` khi có biến `DSH_JDTLS` (image đã đặt sẵn, trỏ tới launcher `/usr/local/bin/dsh-jdtls` của Eclipse JDT Language Server). Agent dùng tool này để tìm định nghĩa, mọi chỗ tham chiếu, các implementation và xem hover cho file `.java`, chính xác hơn grep.

jdtls đọc Maven theo cấu hình offline của image, cùng `/m2/repository`. Lần query đầu tiên trên một project, jdtls phải import project nên có thể mất vài phút (timeout của tool là 5 phút); các lần sau nhanh. Index nằm trong `/var/cache/dsh-jdtls` của container, không ghi vào workspace, và mất khi recreate container. jdtls chạy trên JDK 21; project khai báo Java 8 (`maven.compiler.source` 1.8) được build với runtime `JavaSE-1.8` trỏ tới JDK 8. jdtls chạy kèm Lombok 1.18.48 (javaagent), nên project dùng Lombok không bị báo lỗi giả ở constructor, getter hay builder sinh ra. Heap giới hạn 2 GB cho mỗi project đang mở. Muốn tắt: đặt `DSH_JDTLS=` (để trống) trong `docker/compose.env`.

### Database (Oracle, PostgreSQL)

- PostgreSQL: `psql` (bản client của Debian 12).
- Oracle: SQLcl, lệnh `sql`, chạy trên JDK 21 có sẵn. Ví dụ: `sql -S user/password@//db-host:1521/SERVICE`.

Container phải ra được host và port của DB. Nên dùng tài khoản DB dev chỉ đọc. dsh lọc mọi biến môi trường có tên chứa `KEY`, `PASSWORD`, `SECRET` hoặc `TOKEN` khỏi command của agent, nên `DB_PASSWORD` sẽ không tới được `sql`/`psql`; muốn agent tự kết nối thì đặt chuỗi kết nối vào biến tên khác trong `docker/compose.env`, ví dụ `DEV_ORACLE_URL=user/pass@//db-host:1521/SERVICE` hoặc `DEV_PG_URL=postgresql://user:pass@db-host:5432/app`, rồi chạy `sql -S "$DEV_ORACLE_URL"` hay `psql "$DEV_PG_URL"`.

### Git qua SSH

Image có `openssh-client` và `git-lfs`. Đặt `DSH_SSH_DIR` trỏ tới một thư mục trên host chứa private key, `config` và `known_hosts`; entrypoint copy nó vào `.ssh` trong home của user chạy container (`/root/.ssh`, hoặc `/home/node/.ssh` khi compose đặt `user: 1000:1000`) với quyền 600 (ssh từ chối key mount thẳng từ Windows vì hiện là 0777). Agent dùng được key này, nên nên dùng deploy key riêng thay vì key cá nhân. `known_hosts` phải có sẵn host Git, vì command trong sandbox không ghi thêm được.

### Tool dòng lệnh khác

`xmllint` (đọc và kiểm tra `pom.xml`), `yq` (YAML/XML/properties, ví dụ `application.yml`), `tree`.

### npm và pip qua Nexus

Container không ra được npm và PyPI. Nếu công ty có Nexus, thêm vào `docker/compose.env`:

```sh
NPM_CONFIG_REGISTRY=https://nexus.company.local/repository/npm-group/
PIP_INDEX_URL=https://nexus.company.local/repository/pypi-group/simple
```

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
  -t nguyentrungthaoit/dsh:0.2.1-alpha.10 \
  -t nguyentrungthaoit/dsh:latest \
  .

docker login
docker push nguyentrungthaoit/dsh:0.2.1-alpha.10
docker push nguyentrungthaoit/dsh:latest
```

`DSH_CLIENT_COMMIT_HASH` là commit 7–40 hex (context Docker không gồm `.git`).

Image proxy egress (Squid) build từ gói Ubuntu 24.04 vì tag `ubuntu/squid:latest` không còn được build lại và thiếu các bản vá Squid năm 2026. Dùng thay `ubuntu/squid` với cùng cổng 3128, cùng `/etc/squid/squid.conf`, log ra stdout. Build lại định kỳ để nhận bản vá mới:

```sh
docker build -t nguyentrungthaoit/dsh-squid:6.14 docker/squid
docker push nguyentrungthaoit/dsh-squid:6.14
```

## Shell trong image

Container có `bash`, `git`, `curl`, `jq`, `rg` (ripgrep), `make`, `sqlite3`, `zip`/`unzip`, `xz`, `file`, `less`, `ps` và `tini` (PID 1, chuyển SIGTERM và thu process con). `python3` và `pip` trên `PATH` là venv `/opt/dsh-py`, đã cài `python-docx` 1.2.0, `openpyxl` 3.1.5, `pypdf` 6.19.0, `pandas` 2.3.3, `matplotlib` 3.10.7, `python-pptx` 1.0.2 và `XlsxWriter` 3.2.9. Agent gọi `python3` khi cần đọc `.docx`, `.xlsx` hoặc chữ trong PDF.

Mạng công ty không cho tải package lúc chạy, nên mọi tool agent cần đều nằm sẵn trong image. Image cài font Noto (đủ dấu tiếng Việt), DejaVu, Liberation (thay Arial/Times/Courier cùng kích thước chữ) và Carlito/Caladea (thay Calibri/Cambria). Xem trước file Office trong Web và biểu đồ `matplotlib` dùng các font này.

Image có `HEALTHCHECK`: `docker ps` hiện `healthy` khi Web trả lời ở cổng 3080 trong container. Image đặt `DSH_PRIMARY_RUNTIME=/opt/dsh-runtime` (`runtime.json` ghi phiên bản venv), nên các preset Web gắn skill `office-docx`, `office-xlsx`, `office-pptx` và tool `load_workspace_dependencies`: model tạo, sửa và kiểm tra file Word, Excel, PowerPoint bằng venv này, rồi xuất PDF bằng LibreOffice Kit. Đặt `DSH_PRIMARY_RUNTIME=` (rỗng) để tắt. `pip install` vào `/opt/dsh-py` mất khi tạo lại container; venv tạo dưới `/workspace` nằm trên mount của máy host.

## Custom skill

Cách gắn thư mục skill nằm ở [cấu hình custom skill](../docs/user/guide/custom-skills.vi.md).

## Lưu ý vận hành

Web UI điều khiển agent (shell/filesystem trong container). Chỉ publish port trên mạng nội bộ/VPN; nếu expose ra ngoài hãy đặt reverse proxy có auth.

Các tool chạy file không tin cậy, như `read_document`, luôn chạy trong sandbox. Image cài `bubblewrap` (runner đầu tiên trên Linux) và build sẵn launcher `landlock-run` (runner dự phòng, cần kernel bật Landlock). Không runner nào dùng được thì tool báo `SANDBOX_UNAVAILABLE` thay vì chạy không sandbox. Trên Docker Desktop (WSL2) cả hai đều chạy với seccomp mặc định; Landlock ở đó chỉ ở mức ABI cũ (`partially enforced`). `bubblewrap` vẫn chạy đầy đủ khi container dùng `user: "1000:1000"`, `cap_drop: [ALL]` và `no-new-privileges:true`.
