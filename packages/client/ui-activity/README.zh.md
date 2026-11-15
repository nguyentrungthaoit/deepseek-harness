---
description: "Web 客户端右侧栏的活动标签页：会话最新一轮的实时指标与火焰图、工作区 git 图和模型速度历史。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity

[English](README.md) | 中文

## 概述

本包为右侧栏新增一个**活动**页。紧凑指标显示最新一轮的上下文用量、缓存命中占比、运行中的工具、子代理与后台任务，以及已用时间。git 图列出工作区最新的提交，并统计未提交的更改。模型速度部分按一天中的小时绘制输出速度与首 token 用时的中位数。火焰图把每个模型步骤和每次工具调用画成一条，排在同一时间轴上，嵌套调用缩进在父调用之下。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中挂载浏览器行。该行需要 `slots`、`locale`、`sidebarRightTabs`、`uiConversation` 与 `jobs` 服务，并注册到 [`ui-sidebar-right`](../ui-sidebar-right/README.zh.md) 的 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title` 座位。宿主半边需要 `connection` 与 `workspaceChanges`，并提供 git 图使用的只读路由 `/api/activity.git`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `gitCommits` | `8` | git 图列出的提交数；宿主会把请求截到 [`workspace-changes`](../../deliverables/workspace-changes/README.zh.md) 的 `maxCommits` |
| `speedSamples` | `2000` | 本浏览器最多保留的模型步骤速度样本数；超出时先丢弃最旧的 |
| `speedMinBucketSamples` | `3` | 一天中的某个小时至少需要多少样本，`activitySpeed` 服务才会优先使用它而不是该模型的全天中位数 |
| `speedRecentRuns` | `30` | 速度折线图绘制的最近运行次数 |

### 预期效果

打开右侧栏，在引导页选择**活动**。该页跟随它所在的会话。

指标只在其来源已报告数值时出现。上下文指标需要供应商报告的提示大小和路由容量两者。缓存指标需要本轮至少一个已完成步骤报告了缓存读取。运行计数与已用时间在会话有轮次后出现。该页不显示费用。

火焰图中，模型步骤按输出着色：等待首个 token、思考（仅推理）或输出。步骤条前段较浅的部分是首 token 用时。工具调用为绿色，子代理委派为橙色，失败的调用为红色。悬停或聚焦条形会显示其名称、类型与用时。进行中的条形会脉动，系统要求减少动态效果时除外。

**Git** 部分在宿主报告该会话工作目录属于某个仓库后出现，否则保持隐藏。它显示分支，一行如“3 个文件已更改，+12 −4”的未提交工作树统计（无差异时显示“工作区无未提交更改”），以及最新提交：圆点位于各泳道上，附短哈希、标题与时间；合并提交会向每个父提交所在泳道画线。它在一轮结束或工具调用完成时重新读取，从不按定时器轮询。

**模型速度**部分以会话最新完成步骤所用的模型命名。它显示输出速度（词元/秒）与首 token 用时的中位数、两者按本地小时划分的 24 根柱状图（当前小时高亮），以及最近运行的折线图。步骤记录了首个 token 才会计入；速度还需要供应商报告的输出 token 数。本浏览器打开过的所有会话的样本累积在 `localStorage` 中，因此图表能显示共享模型何时变慢。

#### 供其他插件使用的速度历史

本插件提供 `activitySpeed`。`ctx.get('activitySpeed')?.expected(model, atMs)` 返回 `{ samples, ttftMs, tokensPerSecond }`：当 `atMs` 所在本地小时至少有 `speedMinBucketSamples` 个样本时为该小时的中位数，否则为该模型的全天中位数；模型从未出现过则返回 undefined。停顿阈值可据此伸缩；本仓库目前尚无调用方。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`deriveTurnActivity`](src/client/activity.ts) 折叠 [`ui-chat`](../ui-chat/README.zh.md) 的 Chat 目标快照，Conversation 装配每个动画帧至多发布一次该快照。它选取已加载且记录了 `turn/start` 的最新轮次。步骤条从 `step/start` 开始，到 Assistant 完成时结束；流式中的步骤按其最新块分类。工具条覆盖 `tool/call` 到 `tool/result`，递归跟随每个调用的子调用，并排除仍在准备参数的调用。缓存占比为缓存读取除以未缓存输入、缓存读取与缓存写入之和，在本轮已完成步骤上累加。[`ActivityPanel`](src/client/ActivityPanel.tsx) 按快照的时间线与兼容切片记忆折叠结果。它的时钟每 250 毫秒走一次，减少动态效果时每秒一次，且只在标签页可见且轮次未结束时运行。上下文指标读取 `contextPressure` 投影，任务数读取 `jobs` 名册，正文挂载期间会监视该名册。

[`sampleSteps`](src/client/speed.ts) 度量每个已完成、未中断、写明模型且记录了首个 token 的 Assistant 节点：首 token 用时为 `step/start` 到首个 token，速度为输出 token 数除以首个 token 到最终消息的时间。`createSpeedHistory` 以 `<sessionId>:<seq>` 为键保存样本，重新加载历史不会重复计入；按 `speedSamples` 设上限，并持久化到 `dsh.activity.speed`，存储被阻止时只保留在内存中。历史保存在浏览器中，因为宿主没有跨会话的逐步骤耗时汇总；`sessionStats` 只汇总单个会话的总量。宿主半边用 `workspaceChanges.repository` 回答 git 路由，它只读地运行 `rev-parse`、`log`、`diff --numstat` 与 `ls-files --others`。[`layoutGraph`](src/client/git-graph.ts) 通过跟踪每条泳道指向的提交来分配泳道。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-sidebar-right](../ui-sidebar-right/README.zh.md) — 标签页注册表、引导页与正文座位。
- [ui-chat](../ui-chat/README.zh.md) — 时间线折叠的 Chat 目标快照。
- [token-meter](../../llm/token-meter/README.zh.md) — 上下文指标背后的 `contextPressure` 投影。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 浏览器插件行如何加载并注册插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，活动标签页只在浏览器中读取会话状态，不向模型请求添加任何内容。

#### KV Cache 影响

无；本包既不组装也不发送供应商请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

该标签页只绘制会话日志记录的内容。

- **同时含推理与正文的步骤显示为一条输出条。** 日志记录步骤的首个 token 与完成时间，不记录推理何时转为正文。
- **子代理工作只显示为一条。** 被委派的子代理在自己的会话中运行；其步骤与调用不会嵌套在委派之下。
- **只统计已加载的历史。** 起点位于已加载事件窗口之外的轮次，要等该窗口加载后才会出现。
- **git 图需要存活的会话。** 宿主读取它已加载的会话的仓库，且不读取子代理会话，因此会话处于活动状态之前该部分不会出现。
- **未跟踪文件不计入更改行数。** 它们只计入文件数。
- **速度历史按浏览器保存。** 它不跨设备或宿主共享，步骤需记录了首个 token 才会计入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
