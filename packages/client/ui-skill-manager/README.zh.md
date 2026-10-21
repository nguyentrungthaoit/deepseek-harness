---
description: "右侧栏标签页：列出会话项目的技能，并可创建、编辑，以及把 /name 插入输入框。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-manager

[English](README.md) | 中文

## 概述

在右侧栏列出、创建并编辑当前 Session 项目的技能。在对话中使用会把 `/name ` 追加到尚未发送的草稿末尾。

## 目录

- [注册了什么](#what-it-registers)
- [页面](#pages)
- [导航](#navigation)
- [目录数据](#the-catalog)
- [Toast](#toast)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

引导页进入“技能”页。该页按会话划分，不认领资源地址。

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `skills`，id 为 `@deepseek-ai/dsh-client-ui-skill-manager`，档位 `builtin`，没有 patterns，另有一个引导页入口（order 15，标题与描述取自 `skillManager` 命名空间）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot。一次显示一个页面：列表、单个技能的详情、编辑表单或创建表单。技能分为“可编辑”（`writable`）和“只读”两组，空组隐藏。
- **Toast**：id 为 `skill-manager.toast` 的 `shell.overlay` 入口。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot。

在对话中使用会在 Session 作用域上发出 `conversation/input-append-text`，载荷为 `{ text: '/' + name + ' ' }`。对话输入中心把这段文字追加到草稿末尾。

本包注入 `@deepseek-ai/dsh-client-ui-layout` 以使用 `shell.overlay` slot。卡片、弹窗和开关由 `@deepseek-ai/dsh-client-ui-primitives` 组合而成，不向其提升任何组件。

`src/client/` 下的源文件：`definition.tsx`（类型）、`catalog.ts`（列举、写入与删除）、`navigation-store.ts`（按会话的页面）、`Panel.tsx`（路由页面的正文）、`SkillList.tsx`、`SkillDetail.tsx`、`SkillForm.tsx`（各页面）、`SkillParts.tsx`（详情页与表单共用的渲染内容和 Subagent 行）、`subagent-switch.ts`（Subagent 写入）、`SkillToast.tsx`（toast）、`Title.tsx`（标签页标题）、`locales.ts`（文案）、`index.ts`（接线）。

<a id="pages"></a>
## 页面

- **列表。**页头有标题、说明提示、刷新和“新建技能”。每张卡片通过唯一的名称按钮打开技能详情，该按钮的 `::after` 覆盖整张卡片；插入按钮和 Subagent 开关位于该覆盖层之上，因此没有交互元素嵌套在另一个交互元素里。每张卡片的 Tab 顺序是名称、插入、开关。插入按钮在悬停或聚焦时显示，粗指针设备上始终显示。描述下方，只读卡片以标签显示 `source`，打开 Subagent 的卡片显示 Subagent 徽标。技能超过五个时，页头下方的搜索框按名称和描述筛选卡片；没有匹配时列表会提示。首次加载显示骨架；加载失败显示带“重试”的提示，已有行时在列表上方，没有行时居中。目录为空时显示一句话和“新建技能”。
- **详情。**“‹ 技能”面包屑，然后是页头：图标、名称、`source` 与 Subagent 开/关标签、描述和操作。所有技能都有“在对话中使用”，可写技能另有“编辑”和“删除”。各节为内容（仅可写）、来源与路径，可写技能还有带说明的 Subagent 开关。内容在文档卡片中按 Markdown 渲染；代码块和宽表格在卡片内滚动。可写技能的正文无法读取时显示提示，且“编辑”被禁用。“删除”打开弹窗，确认后把该行的 `version` 作为 `expectedVersion` 发送。
- **表单。**名称（kebab-case）、描述、Subagent 和内容。每个字段下方有一行说明，出错时由该字段的错误替换，因此错误不会挪动布局。内容可在“编辑”和“预览”之间切换：“编辑”是随文本增高、有最大高度的等宽文本框，“预览”按详情页的方式渲染 Markdown。改名时发送 `replaces`。

<a id="navigation"></a>
## 导航

每个会话在其目录旁有各自的导航 store；会话失去绑定时两者一起清除。在同一会话中关闭再打开标签页，会回到同一页面。详情页对应的技能不再出现在列举结果中时，标签页回到列表。打开的编辑表单保留已输入的内容，并提示技能已被删除或改名；此时保存会重新创建。保存成功后打开所保存技能的详情页，改名时跟随到新名称。

<a id="the-catalog"></a>
## 目录数据

`remote.skills.list` 读取会话目录。`ctx.remote` 上的 `skills/change` 会重新列举每个已打开的会话。本包不读取斜杠菜单缓存。新建和编辑调用 `remote.skills.write`，字段为 kebab-case 名称、描述、subagent 标志、Markdown 正文，以及该行的 `version`（作为 `expectedVersion`）。改名时发送 `replaces`。删除调用 `remote.skills.delete` 并带上 `expectedVersion`。subagent 开关不发送正文，由 host 保留文件正文和其他 frontmatter 键。已有文件 `metadata` 中的 `kind` 既不读取也不修改。遇到 `skills/conflict` 时，面板重新加载目录。已打开的表单保留内容并显示错误，再次保存会使用新版本；来自 Subagent 开关或删除的冲突通过 toast 报告。

<a id="toast"></a>
## Toast

注册拥有一个通知 store，由 `skill-manager.toast` 覆盖层入口渲染，因此标签页关闭后结果仍然可见。它报告保存、删除和 Subagent 开关的成功与失败，以及冲突，不报告进行中的状态。删除失败时卡片保留，开关失败时回到列表中的值。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制会话的技能面板，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录的读取和写入经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只有扁平文件。**写入保存一个 `<name>.md`。这里不编辑嵌套的技能目录。
- **正文不可读。**一行到达时没有正文就不能编辑，编辑按钮被禁用。subagent 开关不发送正文，因此仍可使用。
- **始终生效的指引。**技能在 `/name` 或模型调用时加载，从不自动应用到每一轮。必须始终生效的指引应放进 `AGENTS.md` 或 `CLAUDE.md`，本面板不编辑它们。
- **只读来源。**`writable: false` 的行可以插入输入框，不能编辑、删除，也不能标成子任务技能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
