# Agent Note: 移除技能 kind 并保护技能保存

Status: implemented

[English](2026-10-21-drop-skill-kind-and-guard-skill-saves.md) | 中文

## 问题

右侧栏标签页按 `metadata.kind: rule` 把行分成“规则”和“技能”。这个标签背后没有任何规则行为：`tool-skill` 从不读取 `kind`，规则技能也只在 `/name` 或模型调用时加载，从不在每一轮加载。用户把标签理解为“始终生效”，并把指引放在这里，而模型并没有收到。

保存技能还会重写整个 frontmatter，并由客户端发送正文。一次保存会丢失 `disable-model-invocation`、`whenToUse`、其他 `metadata` 键和注释。切换 Subagent 可能用空字符串覆盖正文，保存也可能覆盖在编辑器里所做的修改。

## 决策

从 `SkillSummary`、`SkillEntry` 和 `SkillWriteRequest` 移除 `kind`，`skill-filesystem` 只呈现 `subagent`。仍带 `metadata.kind` 的文件照常加载，`skills/write` 不改动该键，新文件不会写入它。仍发送 `kind` 的请求会被接受，该字段被忽略。迁移步骤见[升级指南](../../../../docs/upgrade-guide/v0.2.1-alpha.1/skills-drop-kind/guide.zh.md)。标签页改名为“技能”，列表按 `writable` 而非用途分组：“可编辑”和“只读”。不使用“Project”分组，因为 `.dsh/skills` 同样属于项目但只读。

必须在每一轮生效的指引属于 `context/agent-instructions`（`AGENTS.md`、`CLAUDE.md`）。技能面板不编辑这些文件，也不增加自动加载技能的机制。

保存已有文件时就地编辑 frontmatter，只设置 `name`、`description` 和 `metadata.subagent`。其他键、键顺序和注释保留，已有 frontmatter 格式错误时拒绝写入。请求中的 `body` 可省略：省略时保留磁盘上的正文，因此 Subagent 开关不发送正文。`skills/list` 把每个可写行的 `FsVersion` 作为 `version` 返回，`skills/write` 与 `skills/delete` 以 `expectedVersion` 带回。不匹配时返回 `skills/conflict` `RemoteError`；新建使用 `createIfAbsent`，因此两次同名新建不可能都成功。删除先用 `fs.stat` 比较版本再 unlink；由于文件系统服务没有带保护的 unlink，仍留有一个很短的窗口。请求字段由[技能参考](../../../../docs/subsystems/skills.zh.md)负责说明。

客户端在会话目录旁为每个会话保留一个导航 store（列表、详情、编辑、创建），并通过注册所拥有的 `shell.overlay` toast 显示结果。页面行为由[包 README](../../../../packages/client/ui-skill-manager/README.zh.md) 负责说明。

删除确认是 `ui-skill-manager` 用现有 primitive 搭建的小弹窗，带危险色按钮。

## 考虑过的替代方案

**保留 `kind`，只改标签。**该字段仍不会改变模型行为，面板会继续保留一个没有消费者的分类。

**让规则技能在每一轮生效。**这会在 `agent-instructions` 旁增加第二条常驻注入路径，并为用户并未要求的标签改变模型可见请求。`AGENTS.md` 和 `CLAUDE.md` 已承担这个角色。

**保存时从文件中删除 `metadata.kind`。**静默改写用户文件会重复本次要消除的数据丢失行为。保留该键没有危害，因为没有任何代码读取它。

**每次保存都重建整个文件。**丢弃未知键和注释正是缺陷所在。解析后的文档只设置三个键，其余保持不变。

**为 Subagent 开关在客户端记住正文。**外部编辑之后客户端仍会发送过期文本。省略正文则由 host 保留磁盘上的内容。

**后写者胜出的保存。**在列举与保存之间在编辑器里所做的修改会无声丢失。`FsVersion` 保护把它变成用户自行处理的冲突。

**现在把共享确认弹窗提升到 `ui-primitives`。**Plugins、`ui-schedule` 的 `TaskDetail`、`ui-settings-models` 和本面板各自搭建了危险按钮样式不同的删除确认。统一样式会改变另外三个页面，需要设计师评审。`RiskConfirmation` 要求勾选复选框，不适合删除。复制 Plugins 的 JSX 会触发重复代码检查失败。

## 后果

用户不再看到“规则”分组，面板中也没有任何内容暗示技能始终生效。保存会保留用户编写的 frontmatter，开关不会清空正文，外部修改会以冲突形式暴露。冲突多花一次保存：表单保留已输入的内容，再次保存会有意覆盖新版本。

`parseDocument` 保留注释和键顺序，但可能改变它所设置键的引号或缩进。`stat` 与 unlink 之间的删除窗口仍然存在。在下面的后续工作完成之前，会多出第四份手工搭建的确认弹窗。

后续工作：把带危险色调的 `ConfirmDialog` 提升到 `ui-primitives`，并让四处调用点（Plugins、`ui-schedule` 的 `TaskDetail`、`ui-settings-models` 和技能管理器）改用它。该变更会改变三个现有页面，需单独提交 PR 并经设计师评审。

## 测试

`session-controller` 与 `skill-filesystem` 的 host 测试覆盖 frontmatter 保留、可选正文、格式错误的 frontmatter、编辑、改名和删除时的过期版本、重复新建、仅可写行带 `version`、不含 `kind` 的摘要，以及仍带 `kind` 的请求。客户端测试覆盖分组、列表、详情、编辑与创建之间的导航、按会话的视图及清理、删除弹窗及其 `expectedVersion`、开关回滚、冲突处理、标签页关闭后仍存在的 toast，以及卡片的可访问性。
