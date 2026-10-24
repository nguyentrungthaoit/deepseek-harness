# Agent Note: 在 Web 中管理 MCP 服务器行

Status: implemented

[English](2026-10-21-web-mcp-server-management.md) | 中文

## Problem

想在 profile 中添加 MCP 服务器的人只能手工编辑 YAML，或安装仅含配置的 bundle。没有任何地方显示已配置的服务器是否连接、注册了哪些工具、为何停止重试；`mcp-client` 的监督器把这些状态保留在内部。编辑 YAML 还会把 `env` 和 `headers` 中的密钥暴露给在浏览器编辑器里查看该文件的人。

## Decision

Web 客户端提供 MCP 面板，背后是一个状态接缝和 `mcp` Remote。`dsh-mcp-client` 通过 `register(entryId, provider)` 向 `ctx.mcpServers` 报告每个根作用域连接：监督器阶段（`connecting`、`connected`、`closing`、`backoff`、`failed`）、最近一次尝试的错误、已注册的工具、服务器身份，以及关闭未能确认的 stdio 子进程 PID。`dsh-mcp-manager` 拥有服务定义和注册表；它从不导入客户端，因此客户端对它的依赖只涉及类型且是可选的。

注册表列出模块为 MCP 客户端的每个 Loader 行（`moduleNames`，默认 `@deepseek-ai/dsh-mcp-client`），并与 profile 组合结果关联。profile 插入的行原地编辑；来自 bundle 层的行通过覆盖行编辑且不能删除；profile patch 无法定位的行只读。启用与停用仍由插件管理器的 `setPluginEnabled` 负责，使服务器行和插件行只有一条开关路径。写入经由 `ConfigEditor.rewrite`，它按与插件管理器相同的顺序先持有 profile 文件锁、再持有 HMR 队列，并在必需行未能激活时恢复文件和组合结果。

### Secrets

`env` 和 `headers` 是 `role('secret')` 值。列表视图只携带 `redactSecrets` 报告的密钥位置；草稿为每个键携带 `{ keep: true }` 或 `{ value }`，保留的值（包括 `!!js` 表达式）从已存储的行原样复制。返回给浏览器的诊断信息会替换已存储的字面值和 `!!js` 密钥解析后的值。同一声明也让通用设置界面把这些字段视为只写。

### Reconnect

手动重新连接请求连接以新的尝试预算重新开始；连接中、已连接或正在关闭时会拒绝。关闭未能确认之后，或插件从未加载时，注册表在 HMR 下重启 Loader fiber。已知子进程 PID 时，重启需要 `acceptOrphan`，注册表报告该 PID 而不是终止它：这个 PID 可能已属于另一个进程。

### Threat model

创建 stdio 行会在 Host 上运行命令。这与通过插件管理器安装插件的信任级别相同：只有已认证的 Web 会话能访问该 Remote，没有引入新的权限。

## Alternatives considered

**每个服务器一个仅含配置的 bundle。** [持久化插件管理决策](../architecture/2026-09-16-creator-persistent-plugin-management.zh.md)将其用于由提示驱动的安装，它仍是面向模型的路径。对人而言，它隐藏状态，为修改配置强制安装包，并把密钥放进浏览器会显示的文件。

**在 MCP 注册表中启用和停用。** 这会重复插件管理器的覆盖行语义，并让一行有两条可能不一致的开关路径。

**按 `serverName` 标识状态。** Agent 作用域实例可能在另一个 Agent 中重用名称，因此 Loader 条目 id 是唯一且在保存后保持不变的身份。

**每次重新连接都重启 fiber。** 重启会注销所有工具、取消进行中的调用，并在整个连接期间阻塞 HMR；在安全时，监督器自身的重试可以避免这三点。

**按 PID 终止孤立子进程。** PID 会被复用，各平台的终止语义也不同；报告 PID 把决定交给使用者。

## Consequences

使用者无需编辑 YAML 即可查看和修复 MCP 服务器，密钥也不再到达浏览器。保存会在持有 profile 锁时等待新服务器的首次连接尝试，因此慢速服务器会让其他 profile 写入者最多等待编辑器的 `lockWaitMs`。`args`、URL 中的用户信息和查询令牌不会被遮蔽，客户端自身的日志行可能重复原始错误，Agent 或预设作用域的行不会列出。关闭未能确认后的重启可能使之前的进程继续运行。
