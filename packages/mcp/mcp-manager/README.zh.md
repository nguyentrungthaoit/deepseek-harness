---
description: "MCP 服务器连接的状态 seam，以及 Web `mcp` Remote：在 profile 补丁中列出、创建、编辑、删除并重连服务器行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

## 概述

`dsh-mcp-manager` 定义 MCP 状态 seam `ctx.mcpServers`，并实现 Web MCP 页面所用 `mcp` Remote 背后的 registry。[`dsh-mcp-client`](../mcp-client/README.zh.md) 把每个根作用域连接连同其实时状态和工具注册到这里。该 Remote 列出带有这些状态的服务器行，在 profile 补丁中创建、更新和删除行，并发起新的连接尝试。环境变量与请求头的值不会离开 Host。创建 stdio 服务器会在 Host 上运行一条命令。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 profile 中挂载一次 `McpServerRegistry`。它依赖 `loader`、`profileContext` 和 `configEditor`；HMR（热模块替换）可选，但决定编辑是否作用于运行中的组合。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `moduleNames` | `['@deepseek-ai/dsh-mcp-client']` | Loader 条目属于 MCP 服务器行的模块说明符。第一个是 `create` 插入的行所用的模块。 |

### 状态 seam

本包是一个能力 seam 的 Service Definition；`dsh-mcp-client` 是其 Service Provider，`mcp` Remote 是其 Consumer。provider 实现 `McpServerStatusProvider`：报告连接状态、已发现的工具和服务器身份，向订阅者通知变化，并以 `started`、`busy`、`disposed` 或 `needs-restart` 回答 `retry()`。它以原始 Loader 条目 id 调用 `ctx.mcpServers.register(entryId, provider)`，并得到该 effect 的释放函数。来自 agent 作用域或没有条目 id 的注册会被忽略，同一条目 id 重复注册会失败。状态变化以原因 `status` 发出 `mcp/change`；注册与移除发出 `registration`；一次保存完成后发出 `config`。

### Remote 方法

`mcp` Remote 命名空间向已认证的 Web 会话暴露这些方法。行的标识是其 Loader 条目 id，即 `McpServerId`。

| 方法 | 行为 |
|---|---|
| `list()` | profile 的每个 MCP 服务器行，附带配置、密钥位置、实时状态、工具和服务器身份。 |
| `create(draft)` | 以未使用的 `mcp-<serverName>` id 向 profile 补丁插入新行，并等待其激活。 |
| `update(entryId, draft)` | 替换该行的完整配置。 |
| `removeServer(entryId)` | 删除 profile 插入的行，以及所有指向它的覆盖。 |
| `reconnect(entryId, options?)` | 发起新的连接尝试。 |

`create`、`update`、`removeServer` 和 `reconnect` 返回 `McpChangeResult`。其 `application` 为 `applied`；`overridden`，表示更高优先级的层仍决定已保存的值；`restart-required`，表示没有 HMR 可应用该改动；或 `failed`。`warnings` 携带未能确认退出的旧进程提示；profile 中其他行的未激活条目不会报告，已保存的行若未能激活则为 `invalid-config`。失败时 `error.code` 为 `name-conflict`、`read-only`、`invalid-config`、`not-active`、`orphan-unacknowledged` 或 `operation-error` 之一，并附诊断；进程未确认退出时还附 `orphanPid`。服务器名称已被其他行使用时为 `name-conflict`。

请求的条目 id 没有对应行时，以线路错误 `mcp/not-found` 失败。草稿不是对象、传输无效、缺少 `command` 或 `url`、字段类型错误，或在没有已存值处使用 `keep` 时，在任何文件改动之前以 `gateway/bad-request` 失败。

### 所有权

每一行有一个所有权类别。`profile` 行由 profile 自己的补丁插入；`update` 与 `removeServer` 就地编辑它们。`layer` 行由较低优先级的层插入；`update` 在 profile 补丁中写入覆盖，`remove` 被拒绝。`readonly` 行无法在 profile 补丁中寻址，`readOnlyReason` 为 `management-required` 或 `unaddressable`，所有编辑都以 `read-only` 被拒绝。行可寻址时带有 `patchId`。

启用和停用某一行不是这里的方法。它由 [Plugin Manager](../../boot/plugin-manager/README.zh.md) 通过 `pluginManager.setPluginEnabled` 负责；本包只报告 `enabled` 与 `disabled` 状态，并对已停用的行以 `not-active` 拒绝 `reconnect`。

### 密钥

`env`（stdio）和 `headers`（Streamable HTTP）的值不会离开 Host。视图列出每个密钥位置及其是否有值。草稿把每个位置写为 `{ keep: true }`（复制已存值）或 `{ value }`（写入新值）。草稿是完整的下一状态，因此省略的键会被删除。其他字段同样接受 `{ keep: true }`。

以 `!!js` 存储的值在 `config` 中显示为带源码的 `{ expression }`，`{ keep: true }` 原样保留它；它只能被保留或替换为字面量。诊断、警告和状态中的最近错误会把每个已存字面量和每个已解析的、长度至少为四个字符的密钥值替换为 `•••`。

### 保存与重连

每次保存都经过 `configEditor.rewrite`：先取得 profile 文件锁，再进入 HMR 队列，以保留注释的转换编辑补丁，并等待协调完成。因此调用会在新建或变更的服务器首次连接尝试结束后才返回。已保存的行激活失败时报告为 `invalid-config`。

`reconnect` 先调用 provider 的 `retry()`。`started` 结束调用；`busy` 与 `disposed` 以 `not-active` 失败。对于 `needs-restart`，或没有加载 provider 时，插件在 HMR 队列中通过 `fiber.restart()` 重启。若上一次尝试以 `orphanPid` 失败，调用以 `orphan-unacknowledged` 失败，直到调用方传入 `acceptOrphan: true`。没有 HMR 时结果为 `restart-required`。重启会把无法确认已停止的进程作为警告报告。

### 威胁模型

创建 stdio 服务器会以 Host 用户的权限在 Host 上运行其命令。这与通过 [Plugin Manager](../../boot/plugin-manager/README.zh.md) 安装插件的信任级别相同：该 Remote 只能由已认证的 Web 会话调用，不授予该会话本来没有的权限。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

| 源文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpServerRegistry`：provider 映射、Remote 方法、行投影和变更结果 |
| [`src/types.ts`](src/types.ts) | 状态 seam 类型、线路视图与草稿、`mcp/change` 和 `mcp/not-found` 错误 |
| [`src/secrets.ts`](src/secrets.ts) | 不含密钥的行视图、草稿合并与校验、诊断擦除 |
| [`src/patch.ts`](src/patch.ts) | 保留注释的 profile 补丁编辑与补丁 id 分配 |

行来自组合后的 profile 补丁、模块在 `moduleNames` 中的已加载 Loader 条目，以及 app-boot 的所有权解析。行从已存配置读取其密钥，并为擦除而读取实时插件配置，其中 `!!js` 值保存其计算结果。`SECRET_FIELDS` 重复了客户端 Config 的 `role('secret')` 位置，因为本包从不加载该客户端；测试会比对两者。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端](../mcp-client/README.zh.md) — 连接、传输，以及在此注册的 provider。
- [Plugin Manager](../../boot/plugin-manager/README.zh.md) — 启用与停用行，以及插件安装。
- [配置编辑器](../../boot/config-editor/README.zh.md) — 保存所经过的串行化 profile 补丁重写。

<a id="model-experience"></a>
## 模型体验

无，因为该包向 Web 页面报告连接状态，不注册任何提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；已保存的行变更会重新加载其 `dsh-mcp-client` 条目，其工具和指令随后遵循该包的行为。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `args` 以及 URL 中的 userinfo 或查询串令牌在视图中不会被遮蔽，擦除只覆盖 `env` 与 `headers` 的值。
- `dsh-mcp-client` 自己写入的日志行可能重复含有密钥的原始错误；擦除只作用于本包的结果。
- 作用域为 agent 或 preset 的行不会被列出；只出现根作用域的 Loader 条目。
- 保存会持有 profile 锁，直到新服务器的首次连接尝试结束，因此慢速服务器会延迟其他 profile 编辑。
- 在关闭未确认之后重启，可能让上一个进程继续运行。会报告其 PID，但从不终止该进程。
- `!!js` 值只能被保留或替换为字面量，不能作为表达式编辑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 — 点击展开</summary>

无。

</details>
