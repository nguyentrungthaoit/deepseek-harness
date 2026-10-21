# Agent Note: Drop the skill kind and guard skill saves

Status: implemented

English | [中文](2026-10-21-drop-skill-kind-and-guard-skill-saves.zh.md)

## Problem

The right Sidebar tab split rows into "Rules" and "Skills" by `metadata.kind: rule`. Nothing behind that label behaved like a rule. `tool-skill` never reads `kind`, and a rule skill loads only on `/name` or a model call, never on every turn. Users read the label as "always applies" and put guidance there that the model did not receive.

Saving a skill also rewrote the whole frontmatter and sent the body from the client. A save lost `disable-model-invocation`, `whenToUse`, other `metadata` keys, and comments. A Subagent toggle could overwrite the body with an empty string, and a save could overwrite a change made in an editor.

## Decision

`kind` is removed from `SkillSummary`, `SkillEntry`, and `SkillWriteRequest`, and `skill-filesystem` presents only `subagent`. A file that still has `metadata.kind` loads normally, `skills/write` leaves the key untouched, and new files do not get one. A request that still sends `kind` is accepted and the field is ignored. The [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-alpha.1/skills-drop-kind/guide.md) lists the migration. The tab is named "Skills", and the list groups rows by `writable`, not by purpose: Editable and Read-only. A "Project" group would be wrong because `.dsh/skills` also belongs to the project but is read-only.

Guidance that must apply to every turn belongs to `context/agent-instructions` (`AGENTS.md`, `CLAUDE.md`). The skill panel does not edit those files and adds no mechanism that loads skills automatically.

A save edits an existing file's frontmatter in place and sets only `name`, `description`, and `metadata.subagent`. Other keys, key order, and comments stay, and a malformed existing frontmatter is rejected without writing. The request's `body` is optional: an omitted body keeps the body on disk, so the Subagent switch sends no body. `skills/list` returns each writable row's `FsVersion` as `version`, and `skills/write` and `skills/delete` take it back as `expectedVersion`. A mismatch is the `skills/conflict` `RemoteError`; a create uses `createIfAbsent`, so two creates of one name cannot both succeed. Delete compares the version with `fs.stat` and then unlinks; a short window remains because the filesystem service has no guarded unlink. The [skills reference](../../../../docs/subsystems/skills.md) owns the request fields.

The client keeps one navigation store per session beside the session's catalog (list, detail, edit, create) and shows outcomes through a `shell.overlay` toast owned by the registration. The [package README](../../../../packages/client/ui-skill-manager/README.md) owns the page behavior.

Delete confirmation is a small modal built in `ui-skill-manager` from existing primitives with a danger-tone button.

## Alternatives considered

**Keep `kind` and rename the label.** The field still would not change model behavior, and the panel would keep a classification with no consumer.

**Make rule skills apply on every turn.** This adds a second always-on injection path next to `agent-instructions` and changes model-visible requests for a label users did not ask for. `AGENTS.md` and `CLAUDE.md` already carry that role.

**Strip `metadata.kind` from files on save.** Silent rewrites of user files repeat the data-loss behavior this change removes. Keeping the key is harmless because nothing reads it.

**Rebuild the whole file on every save.** Dropping unknown keys and comments is the defect. A parsed document that sets three keys keeps the rest.

**Client-side body memory for the Subagent switch.** The client would still send stale text after an external edit. Omitting the body lets the host keep what is on disk.

**Last-write-wins saves.** An editor change made between list and save would be lost without notice. The `FsVersion` guard turns it into a conflict the user resolves.

**Promote a shared confirm dialog to `ui-primitives` now.** Plugins, `ui-schedule` `TaskDetail`, `ui-settings-models`, and this panel each build a delete confirmation with a different danger button. Choosing one changes three other pages and needs designer review. `RiskConfirmation` requires a checkbox and does not fit deletion. Copying the Plugins JSX would fail the duplication check.

## Consequences

Users no longer see a Rules group, and nothing in the panel suggests that a skill always applies. Saves keep user-authored frontmatter, a toggle cannot erase a body, and external edits surface as a conflict. A conflict costs one extra save: the form keeps the typed content, and saving again overwrites the new version on purpose.

`parseDocument` keeps comments and key order but can change quoting or indentation of the keys it sets. The delete window between `stat` and unlink remains. A fourth hand-built confirmation exists until the follow-up below.

Follow-up: promote a danger-tone `ConfirmDialog` to `ui-primitives` and move the four call sites (Plugins, `ui-schedule` `TaskDetail`, `ui-settings-models`, and the skill manager) onto it. That change alters three existing pages and goes in a separate PR with designer review.

## Testing

Host specs in `session-controller` and `skill-filesystem` cover frontmatter preservation, optional bodies, malformed frontmatter, stale versions for edit, rename, and delete, duplicate creates, version-only-on-writable rows, summaries without `kind`, and a request that still carries `kind`. Client specs cover grouping, navigation between list, detail, edit, and create, per-session views and cleanup, the delete modal and its `expectedVersion`, switch rollback, conflict handling, the toast surviving a closed tab, and card accessibility.
