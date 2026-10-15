# 读取 Word、PDF 和 Excel 文件

[English](read-document.md) | 中文

[Tiếng Việt](read-document.vi.md)

## 概述

让模型读取工作区中的 Word、PDF 或 Excel 文件，或你在输入框附上的文件，得到正文和表格。模型使用 `read_document`。文本工具 `read` 会把这些文件当作二进制而拒绝。

## 目录

- [让模型读取文件](#ask-the-model)
- [哪些文件可用](#which-files)
- [挂载工具](#mount-the-tool)
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

<a id="mount-the-tool"></a>
## 挂载工具

随发行版交付的 Web preset 还不包含此工具。把下面一行加到会话所用的 preset。`standard`、`ptc` 和 `cordis` 已包含文件工具。`minimal` 不包含。

```yaml
- id: tool-document
  name: '@deepseek-ai/dsh-tool-document'
```

把该行放在 `tool-fs` 旁边。包自带全部限制，因此 `config` 可省略。Desktop 和 SDK profile 不包含这一行。

<a id="limits-and-failures"></a>
## 限制与失败

大于 32 MiB 的文件会失败，不会被截断。Word 或 Excel 包若超过 2000 个 ZIP 条目，或声明的未压缩大小超过 32 MiB，会在解析前失败。一次 PDF 读取停在 50 页。一次调用最多返回 2000 行，且这些行不超过 50 KiB。Excel 停在 32 个工作表，每个表最多 5000 行数据。超过 30 秒的调用会被停止。

没有可用的 sandbox 时调用失败。解析不会改在 Web 服务器进程里继续。损坏或加密的文件会使调用失败。没有文字层的 PDF 调用成功，并告诉模型没有可读取的文字。

<a id="further-exploration"></a>
## 延伸阅读

- [包契约](../../../packages/document/tool-document/README.zh.md) — 配置字段和模型看到的结果。
- [使用 Web UI](./index.zh.md) — 启动服务器并选择工作区。
