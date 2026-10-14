# 本地 PDF 字段列表

[English](local-pdf-field-list.md) | 中文

[Tiếng Việt](local-pdf-field-list.vi.md)

一轮读取一份 10 到 30 页的 PDF，以及 rule 文件和 skill（技能）。本地模型随后返回 `{prompt, fields}`。会话之外的程序把 `fields` 编译成 Vertex `responseSchema`，并调用 `gemini-3.1-pro-preview`。会话本身不调用 Vertex。

## 1. 加载 rule 和 skill

本地模型在选择字段之前读取这四个文件。[plan-from-pdf](../../workspace/local-extract/skills/plan-from-pdf.md) 是操作步骤。它要求加载 [field-list](../../workspace/local-extract/rules/field-list.md)、[default-envelope](../../workspace/local-extract/rules/default-envelope.md) 和 [vertex-schema-limits](../../workspace/local-extract/rules/vertex-schema-limits.md)。

把 `@deepseek-ai/dsh-skill-filesystem` 的 `customSkillDirs` 指到下面两个目录，并使用绝对路径。该字段记载于 [文件系统 skill README](../../packages/skill/skill-filesystem/README.zh.md)。

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - <repo>/workspace/local-extract/rules
      - <repo>/workspace/local-extract/skills
```

把 `<repo>` 换成本仓库的绝对路径。当文件是其中一个目录的直接子项，且 frontmatter 的 `name` 与 `description` 有效时，目录中出现该名称。用户消息用 `/plan-from-pdf` 注入操作步骤。

## 2. 发送 PDF 文本和业务规则

在本轮之前提取文本层，并把该文本与业务规则一起发送。10 到 30 页的文本层放得进配置好的 128k 窗口。页面图像把同一窗口花在像素上。

业务规则点名 `data.response` 内的字段。PDF 说明这份文件是否包含这些字段以及它们的位置。[default-envelope](../../workspace/local-extract/rules/default-envelope.md) 里的三个外框字段是固定的，不从 PDF 读取。

## 3. 阅读 skill 点名的页面

会话有 `list_pages` 和 `read_pages` 时，阅读首页、含有表格的页面，以及标题与业务规则相符的页面。文本已经在上下文中的页面保持不读。

没有这些工具时，使用消息里已有的 PDF 文本。只调用会话中存在的工具名。不调用 Vertex。

## 4. 提交一个 JSON 对象

模型对照三条 rule 检查草稿，然后提交一次。对象是 [field-list](../../workspace/local-extract/rules/field-list.md) 规定的 `{prompt, fields}`。消息里只有这一个对象。

`fields` 以 `responseCode`、`responseDesc` 和 `ocrRate` 开头。每个文档字段的 path 都以 `data.response.` 开头。`prompt` 说明任务和书写约定。字段列表留在 `fields` 里。

## 5. 在会话外编译 schema

外部程序从 `fields` 构建 `responseSchema`，并用完整 PDF 与 `prompt` 调用 `gemini-3.1-pro-preview`。正则、字符串长度和数值边界留在 `fields` 之外。该程序在生成之后检查它们。

## 6. 遇到笼统拒绝时拆分

当 Vertex 返回 `Request contains an invalid argument.` 时，外部程序按第一个 path 段拆分文档字段，并合并返回的对象。该状态留在本地会话之外。
