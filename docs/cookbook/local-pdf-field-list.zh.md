# 本地 PDF 字段列表

[English](local-pdf-field-list.md) | 中文

[Tiếng Việt](local-pdf-field-list.vi.md)

本地模型规划一次提取并返回 `{prompt, fields}`。会话之外的程序把 `fields` 编译成 Vertex `responseSchema`，并调用 `gemini-3.1-pro-preview`。会话本身不调用 Vertex。

下面四个文件拥有字段约定。本页说明会话如何加载它们，以及如何让这项工作留在本地上下文窗口内。

## 文件

| 文件 | 目录名称 | 它拥有的内容 |
|---|---|---|
| [field-list](../../workspace/local-extract/rules/field-list.md) | `field-list` | JSON 对象、类型、path 和禁止的 key |
| [default-envelope](../../workspace/local-extract/rules/default-envelope.md) | `default-envelope` | `responseCode`、`responseDesc`、`ocrRate`，以及 `data.response.` 前缀 |
| [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md) | `vertex-schema-limits` | 如何把编译后的 schema 保持到可以提交 |
| [plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) | `plan-from-pdf` | 读哪些页、保留哪些字段，以及唯一一次提交 |

## 注册两个根目录

发现机制接受扫描根目录顶层的扁平 `<name>.md` 文件。它跳过嵌套的 `SKILL.md`。`workspace/local-extract/rules` 和 `workspace/local-extract/skills` 与默认的 `.dsh/skills`、`.agents/skills` 根目录分开。

在 `@deepseek-ai/dsh-skill-filesystem` 插件上设置 `customSkillDirs`。提供方把每个条目交给 `path.resolve`，因此使用绝对路径。该字段记载于 [文件系统 skill（技能）README](../../packages/skill/skill-filesystem/README.zh.md)。

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

把 `<repo>` 换成本仓库的绝对路径。当 frontmatter 的 `name` 为 kebab-case 且存在 `description` 时，目录中出现一条记录。这四个文件用文件主名作为该 name。

## 模型收到什么

存在模型可调用的 skill 且 `skill` 工具可见时，会话在首次请求前列出每个 `name` 和 `description`。模型用 `skill` 工具加载列出的 skill，并收到当前文件正文。用户消息用 `/plan-from-pdf` 注入一个 skill。

`@deepseek-ai/dsh-tool-skill` 上的 `catalogDescriptionMaxLength` 默认为 500。这四条描述都在该上限内。列表保持简短，模型请求某个 skill 时才加载对应正文。

## 一次本地轮次

在会话前提取 PDF 文本并发送该文本。10 到 30 页的文本层放得进配置好的 128k 窗口。页面图像把同一窗口花在像素上。

用户消息包含业务规则、页面文本，以及加载 `plan-from-pdf` 并照做的指令。四个文件留在磁盘上。模型先加载 `plan-from-pdf`，再加载 `field-list`、`default-envelope` 和 `vertex-schema-limits`，提交一个 JSON 对象，然后停止。

本地模型没有 Vertex 调用，也没有状态码可读。正则、字符串长度和数值边界留在 `fields` 之外。外部程序在生成之后检查它们。

## JSON 之后

外部程序从 `fields` 构建 `responseSchema`，并用 PDF 与 `prompt` 调用 `gemini-3.1-pro-preview`。`prompt` 说明任务和书写约定。字段列表留在 schema 里。

当 Vertex 返回 `Request contains an invalid argument.` 时，外部程序按第一个 path 段拆分文档字段，并合并返回的对象。该状态留在本地会话之外。

## 名称缺失时

目录中缺少某个名称，表示文件不是已配置根目录的直接子项，或者 frontmatter 的 `name` 或 `description` 被拒绝。改正路径或 frontmatter。提供方监视这些根目录，因此 frontmatter 的编辑会进入下一次目录，无需重启进程。
