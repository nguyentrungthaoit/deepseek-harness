---
description: "面向模型的 read_document 工具，在只读沙箱子进程中提取 docx、pdf 与 xlsx 的文本和表格。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

## 概述

`dsh-tool-document` 注册 `read_document`，让 agent 从 docx、pdf 和 xlsx 文件提取文本与表格。`read` 会拒绝这些二进制文件，因此模型对这三种扩展名使用本工具。Word 段落和表格变成文本行，Excel 工作表变成制表符分隔的行，PDF 文本来自文本层并带页标记。没有文本层的 PDF 返回提示而不失败。每次提取在一个只读沙箱子进程中解析；同一文件的缓存结果或正在运行的提取会服务后续调用，不再启动子进程。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 需要读取 Word、PDF 和 Excel 文本、而又不应走 `read` 时挂载本包。`read` 会把这些文件当作二进制拒绝。本工具像 `read` 一样返回一个行窗口；PDF 没有文本层时附带提示。

### 何时选择

需要 `.docx`、`.pdf` 和 `.xlsx` 的文本与表格时选择它。`.doc`、`.xls`、`.ppt` 和 `.pptx` 不属于本工具。普通文本文件仍用 `read`。

### 最小配置

每个上限都有默认值。组合可以不写 `config` 也能加载。只在需要收紧或放宽某个上限时设置对应字段。`limit: 0` 会在加载时失败。

```yaml
- name: '@deepseek-ai/dsh-tool-document'
  config:
    limit: 2000
    timeoutMs: 30000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxInputBytes` | `33554432` | 最大文件字节数。超出后以 `FS_TOO_LARGE` 失败，不截断。 |
| `maxArchiveEntries` | `2000` | docx 与 xlsx 在启动子进程前允许的 ZIP 中央目录条目数。 |
| `maxUncompressedBytes` | `33554432` | docx 与 xlsx 在启动子进程前允许的 ZIP 声明未压缩大小。 |
| `maxPages` | `50` | 子进程最多读取的 PDF 页数。 |
| `maxExtractedChars` | `1000000` | 子进程最多返回的字符数。 |
| `timeoutMs` | `30000` | 子进程期限，从 spawn 起算，等待槽位的时间不计入。父进程会终止子进程并等待退出。 |
| `limit` | `2000` | 单次结果的默认行数和最大行数。 |
| `maxLineLength` | `2000` | 单行保留的最大字符数。 |
| `maxBytes` | `51200` | 所选行的最大字节数。 |
| `maxSheets` | `32` | 子进程最多读取的 Excel 工作表数。 |
| `maxRowsPerSheet` | `5000` | 子进程从一张工作表最多读取的非空行数。表头行与其他行一样计数。 |
| `maxConcurrent` | `2` | 同时运行的子进程上限。 |
| `maxQueued` | `8` | 等待子进程槽位的提取数上限。超出的调用立即以 `read_document is busy; retry after the running reads finish` 失败。 |
| `maxHeapMb` | `1024` | 子进程 V8 老生代上限（MiB），以 `--max-old-space-size` 传入。内存溢出退出时以 `read_document ran out of memory; the file is too large to extract` 失败。 |

### 一次调用返回什么

规范结果包含 `path`、`format`（`docx`、`pdf` 或 `xlsx`）、`offset`、由 `{ number, text }` 组成的 `lines`、`totalLines` 和 `truncated`。PDF 没有文本层，或某个提取上限使子进程停止时，才有 `notice`。返回的行不是完整提取文本时 `truncated` 为 true；提取被上限停止时一律为 true。

上限停止会返回已读到的文本，并为每个上限附一句说明，例如 `Extraction stopped at maxPages (50 of 212 pages).`。四个上限是 `maxPages`、`maxSheets`、`maxRowsPerSheet` 和 `maxExtractedChars`；一次读取可以触及多个。

-----

<a id="understand-the-implementation"></a>
## 理解实现

插件只有具名导出：`name`、`inject`、`Config` 和 `apply`。它在 `ctx.tools` 上注册 `read_document`。没有客户端工具视图；通用卡片负责展示。

父进程通过 `ctx.fs` 解析路径，要求普通文件，并用 `readBytes` 读取。超过 `maxInputBytes` 的字节以 `FS_TOO_LARGE` 失败。对 docx 和 xlsx，父进程在 spawn 之前对中央目录调用 `assertZipLimits`。其他扩展名都是工具错误。

每个插件实例有一个缓存，最多保留 4 份提取结果或 8 MiB，键为文件系统后端的稳定目标键（`FsTarget.targetKey`）、`FsInfo.version` 和大小。用 `offset` 继续读取的调用复用缓存文本，不再解析。每次调用仍先通过自己的会话解析并 stat 路径，因此会话不会借助其他会话的缓存条目读取文件。相同键的并发调用共用一个子进程，所有调用方都中止后子进程才停止。读取过程中版本或大小变化的文件不会被缓存。

最多 `maxConcurrent` 个子进程同时运行，另有 `maxQueued` 个调用排队；槽位从读文件之前持有到子进程退出。

子进程从 stdin 接收字节，并把 JSON 文本写到 stdout。argv 携带格式、上限和 `--max-old-space-size`，不携带文件路径。spawn 经 `ctx.sandbox.confine`，模式为 `read-only`。`SANDBOX_UNAVAILABLE` 使工具失败，提示 `read_document cannot run because no sandbox is available on this host; do not retry`。没有宿主内解析回退。超时、取消和 fiber 释放都会终止子进程并等待退出。spawn 不传显式环境，因此子进程得到 subprocess 服务清理后的父环境：名称匹配 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的变量以及所有 `DSH_*` 变量都会被移除。若仍有凭据形状的名称到达子进程，子进程会报错退出。

-----

<a id="further-exploration"></a>
## 进一步探索

- [document 分组](../README.zh.md) — Office 转换与本工具。
- [文件系统工具](../../fs/tool-fs/README.zh.md) — 文本文件使用 `read`。
- [读取 Word、PDF 和 Excel 文件](../../../docs/user/guide/read-document.zh.md) — 在 Web UI 上如何让模型读取。

-----

<a id="model-experience"></a>
## 模型体验

### `read_document`

#### 模型看到什么

模型看到 `read_document`，必填 `file_path`，可选 `offset` 和 `limit`。描述要求对 `.docx`、`.pdf` 和 `.xlsx` 使用 `read_document`，因为 `read` 拒绝二进制文件。成功结果是带行号的文本，以及继续或结束页脚。没有文本层的 PDF 增加 `notice` 且调用不失败；上限停止会增加 `notice` 并把结果标为已截断。系统提示的一个段落告诉模型对这些扩展名使用 `read_document` 而不是 `read`，并用 `offset` 继续读取。失败是工具错误，包括 `FS_TOO_LARGE`、`SANDBOX_UNAVAILABLE`、繁忙错误、内存溢出错误和非零子进程退出。

#### Token 影响

工具定义在保持可见时是固定的前缀成本。正常结果落在 `maxBytes` 以内（默认 50 KiB）。更大的窗口会被截断，并告诉模型下一个 `offset`。

#### KV Cache 影响

上限和可见性不变时，定义保持前缀稳定。每次调用把参数和结果追加在该前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述当前工具，不是任务清单。

- **只读隔离仍然可以读取 `/`。** 这是该沙箱模式已接受的限制。子进程仍然受隔离；沙箱不可用时工具失败，而不是在宿主进程里解析。
- **Windows 无法限制读取。** 那里子进程的读取不受限制。
- **在 Windows 沙箱下从源码启动会失败。** 从源码运行时，子进程通过 tsx 加载 `worker.ts`；对尚未缓存的文件，tsx 无法在 Windows 受限令牌下启动 `esbuild.exe`（`spawn EPERM`）。构建后的启动运行 `lib/worker.js`，不受影响。
- **Docker 中的隔离尚未验证。** 公司镜像没有 bubblewrap，依赖 Landlock，而 Landlock 取决于宿主内核和 Docker 的 seccomp 配置。它在那里是否可用尚未验证；失败时工具以无沙箱错误安全地拒绝运行。
- **没有 OCR、页面图像或旧版 Office 文件。** `.doc`、`.xls`、`.ppt` 和 `.pptx` 会被拒绝。没有文本层的扫描 PDF 返回 `notice`，没有页面文本。
- **Excel 公式不会重算。** 子进程返回文件里保存的缓存值；没有缓存值时返回公式字符串。
- **展示只有通用卡片。** 本包不注册客户端工具视图。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
