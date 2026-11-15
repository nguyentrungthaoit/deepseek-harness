---
description: "Web 客户端的像素风锁屏：侧栏锁屏按钮、快捷键与通用设置行用显示实时 Agent 状态的动画画面遮住页面，输入本地密码后解锁。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-lock-screen

[English](README.md) | 中文

## 概述

本包在你离开键盘时用全屏像素画面遮住 Web 页面。画面是一间深夜的开发者房间：下雨的窗户、霓虹招牌、显示 Java 源码、JVM 堆内存曲线与 Maven 日志的显示器、站着 Duke 的服务器机柜，以及一只会抓 `NPE` bug 的猫。HUD 与状态行显示所有会话的实时 Agent 活动。Matrix 样式则以下落的代码雨与终端登录框取代房间。输入本地密码后页面重新显示。锁屏只遮住当前浏览器，不会退出登录，运行中的 Agent 也会继续工作。

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

在 Web 组合中挂载浏览器行即可，无需配置。该行依赖 `slots`、`locale` 与 `shortcuts` 服务、侧栏的 `sidebar.footer.action` 槽位、布局的 `shell.overlay` 槽位以及通用设置的 `settings.general.item` 槽位；画面状态行读取 [`ui-session`](../ui-session/README.zh.md) 的会话列表与状态源。

### 预期效果

可以通过侧栏底部 Settings 上方的**锁屏**按钮、**设置 → 通用 → 锁屏 → 立即锁屏**，或**锁定屏幕**快捷键（默认 Ctrl+Shift+L，macOS 为 Cmd+Shift+L；快捷键服务在 Linux 的 Web 上只接受少数绑定，因此请在快捷键设置中自行绑定）锁定页面。第一次锁屏会要求输入两次密码；之后锁屏直接进入画面。

画面先显示标题屏。按任意键或点击会打开密码提示；Esc 返回标题屏，F 切换浏览器全屏。密码错误时对话框抖动，并打印带尝试次数的 Java 堆栈；密码正确时显示约一秒的 BUILD SUCCESS，然后显示页面。状态行按优先级只列出一个会话：等待批准的会话，其次是运行中的会话，再其次是已完成但未查看的会话，否则显示空闲。HUD 统计运行中、等待中与已完成的会话数，画面中的开发者只在 Agent 运行时打字。

**设置 → 通用 → 锁屏** 还可以选择样式：**像素房间**（默认）或 **Matrix**。Matrix 样式以设备分辨率用绿色片假名代码雨铺满视口，并在中央显示终端登录框：它逐字打出 Agent 状态，并直接打开密码输入框，没有标题屏，Esc 清空输入。以该样式锁屏时浏览器还会进入全屏，页面显示时退出全屏；刷新后第一次按键或点击会恢复全屏，因为浏览器只允许由用户操作触发全屏。Agent 运行时代码雨下落更快，全部空闲时变慢，有会话等待批准时部分列变红。密码错误时显示带尝试次数的 ACCESS DENIED；密码正确时先显示 ACCESS GRANTED 再显示页面。同源的所有标签页都会同步所选样式。

视口允许时像素画面按整数倍缩放，因此 2560x1440 的全屏显示会把每个画面像素画成 4x4 的方块。提示、消息与会话标题以系统字体的 DOM 文本渲染，因此任何语言与标题都能显示。

锁定的页面在刷新后仍保持锁定；在一个标签页中锁定或解锁，同源的所有标签页都会同步。设置行还提供**设置密码**或**修改密码**（输入两次新密码，页面保持显示）以及**移除密码**（清除密码，下次锁屏会要求设置新密码）。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`LockController`](src/client/lock-store.ts) 在 localStorage 的 `dsh.lock-screen` 下维护一条记录：锁定标志，以及由 [`password.ts`](src/client/password.ts) 使用 `@noble/hashes` 计算的 PBKDF2-SHA256 校验值（盐、迭代次数、摘要）；该库在 WebCrypto 的 `subtle` 不可用的纯 HTTP 源上同样可用。每次读取都会解析并校验记录；格式错误的记录视为未锁定且无密码。其他标签页通过 `storage` 事件同步。覆盖层先校验密码而不改变状态，显示成功消息后再解除锁定，因此画面能展示该消息。

[`LockOverlay`](src/client/LockOverlay.tsx) 是 `shell.overlay` 条目。锁定期间它把带 `data-shortcut-modal="lock-screen"` 的 `aria-modal` 对话框传送到 document body，使快捷键服务屏蔽应用命令，并由 [`useModalLayer`](../ui-primitives/src/useModalLayer.ts) 管理焦点与 Esc。[`PixelScene`](src/client/scene.ts) 由 `requestAnimationFrame` 以固定的 60 Hz 步长推进，并用 [`pixel-font.ts`](src/client/pixel-font.ts) 中的 3x5 点阵字体绘制 640x360 画布，因此画面不需要 Web 字体。[`LockThemeController`](src/client/theme-store.ts) 把样式保存在单独的 `dsh.lock-screen.theme` 键下；[`MatrixRain`](src/client/matrix.ts) 同样以 60 Hz 步长推进代码雨，并用 `fillText` 绘制在按设备像素匹配视口大小的画布上；[`MatrixOverlay.module.css`](src/client/MatrixOverlay.module.css) 沿用像素对话框的类名，因此两种样式渲染同一棵对话框树。[`fullscreen.ts`](src/client/fullscreen.ts) 封装 Fullscreen API 并忽略被拒绝的请求，因为覆盖层无论如何都会遮住视口。[`summarizeAgents`](src/client/agent-status.ts) 从会话列表与 `SessionStatusSnapshot` 推导状态行与计数。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [ui-session](../ui-session/README.zh.md) — 状态行读取的会话列表与状态源。
- [shortcuts](../shortcuts/README.zh.md) — 命令注册、改绑与模态屏蔽。
- [ui-sidebar](../ui-sidebar/README.zh.md) — 声明 `sidebar.footer.action` 的侧栏底部。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无；锁屏属于浏览器界面，密码与状态显示都不会进入模型请求。

#### KV Cache 影响

无；本包不组装也不发送 provider 请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

锁屏只是单个浏览器中的隐私遮罩，以下限制都源于它只在客户端运行。

- **锁屏只遮住页面，不是访问控制。** 能使用该浏览器配置文件的人可以清除站点数据或直接调用 Host；请用 Host 的认证阻止他人访问。
- **忘记密码需要清除站点数据。** 删除该源 localStorage 中的 `dsh.lock-screen` 条目，然后刷新。
- **画面中的美术文字为英文。** 霓虹、HUD、显示器与堆栈文字属于美术素材；提示、说明与状态行跟随语言设置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
