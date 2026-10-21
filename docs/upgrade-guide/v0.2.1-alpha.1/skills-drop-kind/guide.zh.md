---
kind: upgrade-guide
description: "技能目录 API 移除 rule/skill 分类 kind，侧边栏标签改名为“技能”。"
---

# 技能不再区分 rule 与 skill

[English](guide.md) | 中文

## 变更

移除 `SkillSummary.kind`（`@deepseek-ai/dsh-skill`）、`SkillEntry.kind` 和 `SkillWriteRequest.kind`（`skills/list`、`skills/write`）。技能文件中的 `metadata.kind` 不再有任何作用：文件仍可加载，`skills/write` 保留已有的值，新文件不再写入该键。仍携带 `kind` 的 `skills/write` 请求会被接受，该字段被忽略。

右侧栏原名“规则与技能”的标签现在叫“技能”，在同一个视图中列出全部技能。

## 迁移

1. 删除对 `SkillSummary`、`SkillEntry` 的 `kind` 读取，以及依赖它的分组；改用 `SkillEntry.writable` 分组。
2. 不再在 `SkillWriteRequest` 中发送 `kind`。
3. 需要始终生效的指引时，把 `metadata.kind: rule` 技能的内容移到 `AGENTS.md` 或 `CLAUDE.md`；规则技能从不会自动应用到每一轮。
4. 确认 `skills/list` 的行不含 `kind`，并且客户端的 `pnpm run typecheck` 通过。
