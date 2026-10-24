---
description: "保存当前 profile 配置，并通过 Loader 应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-config-editor

[English](README.md) | 中文

## 概述

将插件配置保存到当前 profile 的 patch 并立即应用。写入在改动磁盘前验证完整候选值，并与 profile 更改及 HMR 串行执行。无效值和更高层覆盖不会改动文件。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在具有 Loader 和 `profileContext` 的 profile 应用中挂载此服务。

```yaml
- id: config-editor
  name: '@deepseek-ai/dsh-config-editor'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `lockWaitMs` | `120000` | 保存等待其他写入方释放 profile 锁的最长毫秒数。 |

因此，当 [Plugin Manager](../plugin-manager/README.zh.md) 持有该锁（例如安装软件包期间）时，设置保存最多等待 `lockWaitMs`；在此时间内未获得锁的保存会失败。

使用 [settings](../../settings/settings/README.zh.md) 提供只编辑即时字段的表单。编辑完整配置的调用方可使用 `ctx.configEditor.edit()`；普通字段保留 Loader 的正常生命周期。`ctx.configEditor.rewrite(change)` 重写整个 patch 文档：`change` 接收保留注释的已解析文档及其顶层条目，可插入或删除行，并返回之后必须处于活动状态的 id。仅含 `__jsExpr` 一个键的 map 写为 `!!js` 表达式。`change` 插入的行没有可供验证的 Fiber，只能通过应用阶段验证；返回的 id 未能激活时，恢复文件和组合结果并重新抛出错误。`rewrite` 返回仍处于非活动状态的条目的诊断。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

[编辑器](src/index.ts) 在派生候选配置前应用外部更改，在 `edit()` 和 `rewrite()` 中先持有 profile 文件锁（`<profile>/package.json`），再持有 HMR 队列（与 Plugin Manager 的顺序相同），并原子替换配置覆盖项。它保留替换值以外的 YAML 注释和 `!!js` 表达式。应用失败时恢复之前的文档并重新加载之前的 patch。

读取配置时，没有 profile config 覆盖项的条目共用一次组合结果。有覆盖项的条目分别组合，仅移除自身的覆盖项；profile 插入的条目和其他条目的覆盖项仍然生效。返回的配置为独立副本，组合结果不跨读取缓存。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Profile 加载](../app-boot/README.zh.md)——patch 组合。
- [HMR](../hmr/README.zh.md)——重载协调。
- [设置](../../settings/settings/README.zh.md)——schema 派生表单。

<a id="model-experience"></a>
## 模型体验

通过面向模型的插件读取的配置值间接影响模型。

#### KV Cache 影响

改变请求前缀的消费者决定缓存影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 编辑写入当前 profile patch。Home patch 和命令行 overlay 参与优先级解析，但不作为写入目标。
- 完整配置覆盖保留普通字段，但会在 profile 层固定其当前原始值。
- 仅可编辑 profile 根 Include 拥有且可唯一定位的条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
