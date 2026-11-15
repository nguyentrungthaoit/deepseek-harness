---
description: "从插件管理页启用实验性的每 Session 独立 Chromium 浏览器工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-browser-use-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 组合 browser-use 服务与 [Playwright MCP Provider](../browser-use-playwright-mcp/README.zh.md)，让每个活动 Session 拥有独立的 headless Chromium。随包配置默认禁用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web 侧边栏打开插件管理页并启用浏览器工具。之后新建或恢复的 Session 会带上 Playwright MCP 工具；已经活动的 Session 保持当前工具集。Provider 启动一个 headless、隔离的 Chromium。`DSH_BROWSER_CHROMIUM` 指向某个可执行文件时启动该文件，Docker 镜像将其设为添加 `--no-sandbox` 的启动器；否则由 Playwright 查找自己的安装，该安装必须已存在于本机。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

静态 `cordis.patch.yml` 添加 `browser-use` 服务行与 launch 模式的 Playwright MCP Provider 行。可选 Bundle 的安装方式让两个包都能从安装中解析，而不会在默认 profile 中被选中，从而使实验性 Provider 不进入随包 preset。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

[Playwright MCP Provider](../browser-use-playwright-mcp/README.zh.md) · [browser-use 服务](../../browser-use/browser-use/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接通过 [Playwright MCP Provider](../browser-use-playwright-mcp/README.zh.md) 产生影响，由它负责 `mcp__playwright-mcp__` 浏览器工具及其结果。

#### KV Cache 影响

此 Bundle 不贡献请求前缀内容。面向模型的工具与结果由 Provider 负责。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 此 Bundle 不安装浏览器。在 Docker 镜像之外，Chromium 必须已安装在 Playwright 查找的位置，或由 `DSH_BROWSER_CHROMIUM` 指向某个可执行文件。
- 未提供 attach 模式（复用已有浏览器及其标签页和登录状态）；此 Bundle 总是启动全新的隔离浏览器。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
