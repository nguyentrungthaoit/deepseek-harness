# Agent Note: 在随附基础配置中强制关闭 phone-home 采集器

Status: implemented

[English](2026-09-10-hard-disable-phone-home-collectors.md) | 中文

## 问题

默认安装仍会组合可能接收 Session 前缀的采集器：共享基础配置把未设置的 `DSH_TELEMETRY_MODE` 解析为 `FEEDBACK_ONLY`，环境覆盖也可通过基础补丁重新启用 OTel。产品 LLM 出口与 web 工具不需要这些采集器；默认安装不得将会话数据 phone home。

## 决定

随附的 `dsh-base` 以字面量 `mode: DISABLED` 强制关闭 OTel 会话遥测，并将 `session-log-deepseek` 固定为 `enabled: false`。默认基础配置下，采集器不再接收会话前缀。产品 LLM 出口与 web 工具保持不变。

这取代了[反馈门控遥测默认值](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md)记录中的基础默认值：基础配置不再把未设置的 `DSH_TELEMETRY_MODE` 解析为 `FEEDBACK_ONLY`。插件的 `DEFAULT_TELEMETRY_MODE` 为 `DISABLED`，因此省略 `mode` 时也不会上传。`DSH_TELEMETRY_MODE` 与 `DSH_TELEMETRY_OTLP_URL` 不再通过基础补丁重新启用上传；自定义覆盖层仍可有意重新挂载 `FEEDBACK_ONLY`。基础配置行不指定采集器，因此该覆盖层还必须提供自己的 `exporter.url`。

为这些路径提供输入的入口也已关闭。基础配置禁用 `command-feedback`，因此没有 `/feedback`。Web 组合包禁用 `ui-message-feedback`（Like/Dislike 与反馈对话框）和 `ui-settings-session-log`（通用设置中的**上传 Session Log**开关）。`message-feedback` 保持挂载：它只写入本地会话日志，不发送任何内容。产品分析（`desktop-product-telemetry` 与 `product-analytics`）在所有 profile 中禁用，包括 Desktop。

## 考虑过的替代方案

**将反馈门控 OTel 保留为随附基础默认值。** 否决：默认安装不得向采集器发送会话前缀；反馈门控释放仅通过显式覆盖层可用。

**从基础补丁中完全移除 OTel 与 DeepSeek 会话日志插件。** 否决：保留以强制关闭为默认的配置行，可维持单一重新挂载路径，并使可选启用的覆盖层仅需翻转模式与 `enabled`。

**在基础补丁中保留环境驱动的重新启用。** 否决：`DSH_TELEMETRY_MODE` / `DSH_TELEMETRY_OTLP_URL` 不得在没有有意覆盖层的情况下重新打开采集器。

## 后果

- 基于 `dsh-base` 的默认 profile 不构造 OTel 传输，也不注册 DeepSeek 会话日志贡献。
- 需要反馈门控上传的部署在自定义覆盖层中重新挂载 `FEEDBACK_ONLY`（以及任意导出器 URL）；[反馈门控记录](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md)保留该模式的理由。
- 当该配置行存在时，非空的 `DSH_TELEMETRY_DISABLED` 仍会在启动时禁用 OTel 行。
- Web 不显示反馈按钮、反馈对话框和会话日志上传开关。已将 `session-log-deepseek` 设为 `enabled: true` 的 home 补丁仍优先于基础配置。
- `/feedback` 与消息反馈的 Web e2e 场景已移除；`messageFeedback` 的 Host Remote 协议快照保留。

## 测试

- `packages/bundle/base` 测试固定强制关闭的组合，包括 `/feedback`。
- `packages/bundle/web-app` 的产品分析测试固定两行在 Desktop 与 Web 中均禁用，且采集端收不到请求。
- `session-telemetry-otel` 的默认模式测试固定省略 `mode` 时为 `DISABLED`，反馈后也不投递。
