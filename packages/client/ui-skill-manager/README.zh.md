---
description: "右侧栏标签页：列出会话项目的规则和技能，并可创建、编辑，以及把 /name 插入输入框。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-manager

[English](README.md) | 中文

## 概述

在右侧栏列出并编辑当前 Session 项目的规则和技能。在对话中使用会把 `/name ` 追加到尚未发送的草稿末尾。

## 目录

- [注册了什么](#what-it-registers)
- [目录数据](#the-catalog)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

引导页进入规则与技能页。该页按会话划分，不认领资源地址。

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `skills`，id 为 `@deepseek-ai/dsh-client-ui-skill-manager`，档位 `builtin`，没有 patterns，另有一个引导页入口（order 15，标题与描述取自 `skillManager` 命名空间）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot。`kind` 为 `rule` 的行归入规则，其余归入技能。可写行可以编辑、删除、切换 `subagent`，以及插入该技能。只读行显示 `source`，只能插入该技能。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot。

在对话中使用会在 Session 作用域上发出 `conversation/input-append-text`，载荷为 `{ text: '/' + name + ' ' }`。对话输入中心把这段文字追加到草稿末尾。

`src/client/` 下的源文件：`definition.tsx`（类型）、`catalog.ts`（列举、写入与删除）、`Panel.tsx`（正文）、`Title.tsx`（标签页标题）、`locales.ts`（文案）、`index.ts`（接线）。

<a id="the-catalog"></a>
## 目录数据

`remote.skills.list` 读取会话目录。`ctx.remote` 上的 `skills/change` 会重新列举每个已打开的会话。本包不读取斜杠菜单缓存。新建和编辑调用 `remote.skills.write`，字段为 kebab-case 名称、描述、kind、subagent 标志和 Markdown 正文。改名时发送 `replaces`。删除调用 `remote.skills.delete`。subagent 开关用同一份正文把标志反过来再写入。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制会话的规则与技能面板，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录的读取和写入经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只有扁平文件。**写入保存一个 `<name>.md`。这里不编辑嵌套的技能目录。
- **正文记忆。**subagent 开关发送的是 `skills/list` 或本面板最近一次保存提供的 Markdown。一行到达时没有正文，并且尚未在这里保存过，就会以空正文写入。
- **只读来源。**`writable: false` 的行可以插入输入框，不能编辑、删除，也不能标成子任务技能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
