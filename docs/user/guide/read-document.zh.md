# 读取 Word、PDF 和 Excel 文件

[English](read-document.md) | 中文

[Tiếng Việt](read-document.vi.md)

## 概述

让模型读取工作区中的 Word、PDF 或 Excel 文件，或你在输入框附上的文件，得到正文和表格。模型使用 `read_document`。文本工具 `read` 会把这些文件当作二进制而拒绝。

## 目录

- [让模型读取文件](#ask-the-model)
- [哪些文件可用](#which-files)
- [确认工具可用](#check-the-tool)
- [按旧版指南加过那一行](#old-guide-row)
- [限制与失败](#limits-and-failures)
- [延伸阅读](#further-exploration)

<a id="ask-the-model"></a>
## 让模型读取文件

把文件放进已选工作区，或在输入框附上它。附件按原样保存，模型收到一条只读路径。用日常语言说明要读的内容。

例如：“Read report.docx and summarize the table in the first section.”

模型用该路径调用 `read_document`。完成后出现名为 `read_document` 的通用工具行。结果是带行号的文本。Word 的段落和表格变成行，单元格之间用制表符分隔。每个 Excel 工作表先有一行标题，然后是制表符分隔的行。PDF 文本为每个有字的页面带上页标记。

长文件一次只返回一个窗口。让模型继续读，它会用更靠后的 `offset` 再次调用 `read_document`。

<a id="which-files"></a>
## 哪些文件可用

这些扩展名可用：

- `.docx` — 段落和表格。
- `.pdf` — 文字层。没有文字的扫描页返回说明，不返回该页正文。
- `.xlsx` — 工作表名和单元格文本。公式单元格返回文件里已存的值；文件没有存值时返回公式文本。

这些扩展名不可用：`.doc`、`.xls`、`.ppt`、`.pptx`，以及普通文本文件。文本文件仍用 `read`。

<a id="check-the-tool"></a>
## 确认工具可用

随发行版交付的 Web preset `standard`、`ptc` 和 `cordis` 已包含 `read_document`，`minimal` 不包含。Docker 下从镜像 tag `0.2.1-alpha.6` 起，发行版 preset 才包含该工具；在 `docker/compose.env` 里设置 `DSH_IMAGE_TAG`。镜像 `0.2.1-alpha.4` 和 `0.2.1-alpha.5` 含有这个包，但其发行版 preset 不包含它，只有按[旧版指南](#old-guide-row)手动加的那一行能启用它。`0.2.1-alpha.4` 之前的镜像不含这个包，任何配置都加不上该工具。

检查方法：打开 **Settings → Agent presets**，选择会话所用的 preset，点 **View configuration**，搜索 `tool-document`。Desktop 和 SDK profile 不包含它。

<a id="old-guide-row"></a>
## 按旧版指南加过那一行

本指南的早期版本让你在 `/data/dsh/profiles/web/cordis.patch.yml` 里加一个 `tool-document` 块。该块会替换 preset 的整个插件列表，所以随发行版 preset 之后的改动不会再传到你这里。工具仍然可用。二选一：

- 保留该块。一切照旧，但你收不到今后的 preset 变更。
- 只删除你加的那个块，然后重启容器，改用发行版 preset。你在同一个块里做过的其他修改会随之丢失。只在镜像 `0.2.1-alpha.6` 或更新时这样做；在 `0.2.1-alpha.4` 和 `0.2.1-alpha.5` 上，发行版 preset 不包含该工具，删除该块就会去掉它。

<a id="limits-and-failures"></a>
## 限制与失败

大于 32 MiB 的文件会失败，不会被截断。Word 或 Excel 包若超过 2000 个 ZIP 条目，或声明的未压缩大小超过 32 MiB，会在解析前失败。一次调用最多返回 2000 行，且这些行不超过 50 KiB。超过 30 秒的调用会被停止；等待空闲读取进程的时间不计入。

提取还会停在某个上限：50 页 PDF、32 个 Excel 工作表、每个表 5000 个非空行（表头行也计入），或 1,000,000 个字符。结果标为已截断并带一条说明，例如 `Extraction stopped at maxPages (50 of 212 pages).`，同时返回已读到的文本。

同时最多读取 2 个文件，另有 8 个可以排队。超出时调用失败，提示 `read_document is busy; retry after the running reads finish`，等正在运行的读取结束后重试。需要内存过多的文件失败，提示 `read_document ran out of memory; the file is too large to extract`。

主机没有 sandbox 时调用失败，提示 `read_document cannot run because no sandbox is available on this host; do not retry`。解析不会改在 Web 服务器进程里继续。损坏或加密的文件会使调用失败。没有文字层的 PDF 调用成功，并告诉模型没有可读取的文字。

<a id="further-exploration"></a>
## 延伸阅读

- [包契约](../../../packages/document/tool-document/README.zh.md) — 配置字段和模型看到的结果。
- [使用 Web UI](./index.zh.md) — 启动服务器并选择工作区。
