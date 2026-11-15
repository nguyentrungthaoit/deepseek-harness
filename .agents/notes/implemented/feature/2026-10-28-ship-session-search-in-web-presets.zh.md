# Agent Note: 在 Web 预设中随附会话搜索

Status: implemented

[English](2026-10-28-ship-session-search-in-web-presets.md) | 中文

## 问题

公司部署使用上下文上限为 128K 的模型。较长的工作会跨越多个会话，而模型无法查阅同一工作区中较早的会话做过哪些决定或修改，用户只好重复说明，或让会话一直保持很长。[会话搜索不作为随附默认的记录](../../archived/feature/2026-08-02-session-search-not-shipped-default.md)让 `tool-session-query` 不出现在任何随附界面中。

## 决定

Web 的 `standard`、`ptc` 和 `cordis` 预设挂载 `@deepseek-ai/dsh-tool-session-query`，Web 覆盖层开启全文索引：`session-query-sqlite` 使用位于 `dshHomePath('session-index.sqlite')` 的持久索引，并设为 `openAt: first-search`。`minimal` 预设、基础组合包、TUI 和 headless 保持不变。

本记录在本 fork 中取代上述不随附记录里关于 Web 的部分。授权不变：搜索只能访问 `cwd` 与调用方完全相同的会话。基础配置中的 `spill-policy`（`maxInlineTokens: 12500`）限制过大的结果。

## 考虑过的替代方案

**保留内存索引。** 否决：每次重启后，第一次搜索都要重建索引；派生文件可随时丢弃，并与会话存储放在一起。

**在基础组合包中挂载该工具。** 否决：需求只针对 Web 界面，而基础配置行也服务 headless 与 SDK 界面。

**也在 `minimal` 中挂载。** 否决：该预设的目的就是保持请求精简。

## 后果

- 这三个预设中的每个请求都会多带五个工具 schema 和工具说明。
- 启动后的第一次搜索会为会话历史建立索引；之后的搜索复用该文件。
- harness home 下的 `session-index.sqlite` 可随时删除，会被重建。

## 测试

- `apps/web/tests/shipped-composition.e2e.ts` 在默认预设的工具清单中固定这五个 `session_*` 工具。
