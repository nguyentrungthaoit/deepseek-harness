---
description: "从 Web 侧栏管理 profile 的 MCP 服务器：状态、工具、添加、编辑、删除、启停与重连。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-manager

[English](README.md) | 中文

## 概述

使用 Web 侧栏的 **MCP** 入口查看 profile 的 MCP 服务器及其连接状态和工具。可以添加、编辑、删除服务器，开关服务器，并重连正在重试或已停止的服务器。页面驱动 [`dsh-mcp-manager`](../../mcp/mcp-manager/README.zh.md) 的 `mcp` Remote。

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

在侧栏选择 **MCP**，它紧跟在**插件**之后。入口与它打开的 `main` 面板共用 id `mcp`。页面是全局页面，不属于任何 Session。

列表的每一行显示服务器名称、随状态变化色调的状态点（已禁用和未加载为中性，连接中和关闭中为进行中，已连接为成功，重试中为警告，已停止为错误）、传输方式（stdio 或 Streamable HTTP）、归属（**当前 profile**、**来自组合包**或**只读**）、状态文字和工具数量。重试中的行会倒计时显示距下次尝试的秒数。行上的开关启用或禁用该服务器；打开该行显示详情。

详情页显示状态（重试中时附尝试次数）、重试中或已停止服务器的最近错误，以及已停止的服务器可能遗留的孤儿进程 PID。随后是配置摘要（传输方式、命令、参数和工作目录，或 URL）、已保存的环境变量或请求头的名称（不含值）、服务器的名称与版本，以及它提供的工具。该行上一次操作的警告显示在工具下方。

### 添加与编辑服务器

**添加服务器**打开表单；详情页的**编辑**为该行打开同一表单。服务器名称接受字母、数字、`_` 和 `-`，最长 32 个字符。传输方式决定字段：stdio 为命令、参数（每行一个）、工作目录和环境变量，Streamable HTTP 为 URL 和请求头。**高级**包含工具调用超时、启动出错即失败和自动重连。名称有效且命令或 URL 已填写之前，保存按钮保持禁用。

编辑只发送用户改动的内容。该行已保存而表单未触碰的字段会保留，所以保存不会丢失它。环境变量和请求头的值只写不读：已保存的条目显示**已保存；留空则保持不变**，值保持为空就保留原值，输入新值则替换。以 `!!js` 表达式保存的字段显示其源码，只能保留，或通过**替换**换成普通值；表单从不编辑表达式本身。更换传输方式会丢弃已输入的环境变量或请求头。页面报告 Host 的结果：已保存、已保存但仍被更高优先级的层覆盖，或重启后生效。保存被拒绝时表单保持打开并显示原因。

由组合包插入的行可以编辑，因为编辑会往 profile 写入覆盖。Host 标记为只读的行（例如插件管理所需的行）没有**编辑**，页面会说明原因。

### 删除服务器

**删除**只出现在由当前 profile 插入的行上。它先要求确认，再移除该行以及所有指向它的覆盖。组合包的行只能关闭，不能删除。

### 启用与禁用

行上的开关通过 Plugin Manager 的 Remote 调用 `pluginManager.setPluginEnabled`。装配中没有 Plugin Manager 时，开关被禁用并提示**插件管理不可用**；页面仍可列出、编辑、删除和重连。只读行和正在执行操作的行同样被锁定。

### 重连服务器

**重连**对重试中、已停止和未加载的服务器可用，并发起一次新的尝试。Host 报告上一个进程可能仍在运行时，页面给出其 PID 并要求确认；**仍然重启**会在接受孤儿进程的前提下重复调用，此后旧进程可能继续运行，需要用户自行结束。

### 刷新

选中 MCP 面板时页面读取服务器列表。页面打开过之后，还会在 `mcp/change`、`plugin-manager/changed` 和 `connection/reset` 时重新读取；首次打开之前这些事件被忽略。每次变更之后都会重新读取，因此页面显示的是 Host 自己的状态。离开面板后，下次进入回到列表。

### 文案

所有文字来自 `mcpManager` locale 命名空间，注册了中文和英文。服务器名称、服务器报告的错误和工具名称按 Host 发来的原样显示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

浏览器插件注入 `ctx.remote.mcp`、`locale`、`slots` 和 `layout`，并注册 `sidebar.panellist` 入口（order 1）。只有装配挂载了 `ctx.remote.pluginManager` 时才读取它。Host 侧是 [`dsh-mcp-manager`](../../mcp/mcp-manager/README.zh.md) 中的注册表，由它负责归属、密钥和 `McpChangeResult` 结果。

<details>
<summary>实现细节——点击展开</summary>

### 注册

`apply()` 先注册词典，再注册键为 `mcp` 的 `main` slot 条目（带导航 store：列表、服务器、创建、编辑）和 `sidebar.panellist` 条目。对布局中活动面板的订阅在进入时刷新目录，在离开时重置导航。变更监听是 effect，随插件一起销毁。

### 目录

`McpCatalog` 通过 `mcp.list()` 读取，合并重叠的读取，并把每次变更按“置为进行中、取得结果、清除进行中、重新读取”执行。它把线路错误码和操作错误码映射为 locale key；`orphan-unacknowledged` 错误携带确认框所需的 PID。启用和禁用把 Plugin Manager 的结果适配成同样的结果形态。

### 表单模型

`form-model.ts` 把列出的行转成可编辑字段，再转回 `McpServerDraft`。未触碰的已保存字段变成 `{ keep: true }`，未触碰的空字段被省略，编辑过的字段发送其值。参数按行拆分。重连开关会保留表单不编辑的已保存重连键。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [mcp-manager](../../mcp/mcp-manager/README.zh.md)——本页驱动的 Host 注册表和 `mcp` Remote。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页，MCP 入口紧随其后。
- [ui-sidebar](../ui-sidebar/README.zh.md)——MCP 入口注册进的面板列表；[ui-layout](../ui-layout/README.zh.md)——页面占用的主 slot。
- [api-remotes](../../api/remotes/README.zh.md)——页面背后的 Remote BFF 和转发事件。
- [locale](../locale/README.zh.md)——文案使用的词典注册。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的管理界面，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。在此添加或修改的服务器只通过 Host 注册的 MCP 工具到达模型，适用这些工具的缓存行为。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **按存储原样显示的值**——`args` 和 URL 查询串中的令牌在详情页按存储原样显示；只有环境变量和请求头的值被隐藏。请把凭据放在 `env` 或 `headers` 中。
- **`!!js` 值只能保留或替换**——表达式字段无法在表单中编辑；用户只能保留它，或把它换成普通值。
- **不列出 Agent 作用域的服务器**——为某个 Agent 声明的 MCP 行不会出现；页面列出的是 profile 的行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
