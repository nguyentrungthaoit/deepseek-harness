---
kind: upgrade-guide
description: "The skill rule/skill kind is removed from the skill catalog API, and the sidebar tab is renamed Skills."
---

# Skills no longer have a rule or skill kind

English | [中文](guide.zh.md)

## Change

`SkillSummary.kind` (`@deepseek-ai/dsh-skill`), `SkillEntry.kind`, and `SkillWriteRequest.kind` (`skills/list` and `skills/write`) are removed. `metadata.kind` in a skill file no longer has any effect: the file still loads, `skills/write` leaves an existing value untouched, and new files do not get one. A `skills/write` request that still sends `kind` is accepted and the field is ignored.

The right sidebar tab formerly named "Rules and skills" is now "Skills" and lists every skill in one view.

## Migration

1. Delete reads of `kind` from `SkillSummary`, `SkillEntry`, and any grouping that depended on it; group by `SkillEntry.writable` instead.
2. Stop sending `kind` in `SkillWriteRequest`.
3. For always-applied guidance, move content from `metadata.kind: rule` skills into `AGENTS.md` or `CLAUDE.md`; a rule skill never applied itself to every turn.
4. Confirm `skills/list` rows carry no `kind` and `pnpm run typecheck` passes in your client.
