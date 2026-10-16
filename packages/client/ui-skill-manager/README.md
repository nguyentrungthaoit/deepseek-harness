---
description: "Right Sidebar tab that lists, creates, and edits the session project's rules and skills, and inserts /name into the composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-manager

English | [中文](README.zh.md)

## Summary

List and edit this Session's project rules and skills from the right Sidebar. Use in chat appends `/name ` to the unsent draft.

## Table of Contents

- [What it registers](#what-it-registers)
- [The catalog](#the-catalog)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

A guide gives way to the rules and skills page. The page is session scoped and claims no resource address.

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `skills`, id `@deepseek-ai/dsh-client-ui-skill-manager`, band `builtin`, no patterns, and one guide entry (order 15, its title and description from the `skillManager` namespace).
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id. Rules are rows whose `kind` is `rule`. Every other row is a skill. A writable row can edit, delete, flip `subagent`, and insert the skill. A read-only row shows `source` and can only insert the skill.
- **The chip title** — the keyed `sidebar.right.pane.tab.title` seat under that id.

Use in chat emits `conversation/input-append-text` on the Session scope with `{ text: '/' + name + ' ' }`. The conversation input hub appends that text at the end of the draft.

Source files under `src/client/`: `definition.tsx` (the type), `catalog.ts` (list, write, and delete), `Panel.tsx` (the body), `Title.tsx` (the chip title), `locales.ts` (copy), and `index.ts` (the wiring).

<a id="the-catalog"></a>
## The catalog

`remote.skills.list` loads the session catalog. `skills/change` on `ctx.remote` lists every opened session again. This package does not read the slash-menu cache. Create and edit call `remote.skills.write` with a kebab-case name, description, kind, subagent flag, and markdown body. Renaming sends `replaces`. Delete calls `remote.skills.delete`. The subagent switch writes the same body with the flag flipped.

<a id="model-experience"></a>
## Model Experience

None, as this package draws a session rules and skills panel in the browser and registers nothing model-facing.

#### KV Cache effect

None; catalog reads and writes travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Flat files.** Write stores one `<name>.md`. Nested skill directories are not edited here.
- **Body memory.** A subagent toggle sends the markdown last supplied by `skills/list` or by a save in this panel. A row that arrives without a body, and has not been saved here, is written with an empty body.
- **Read-only sources.** A row with `writable: false` can be inserted into the composer and cannot be edited, deleted, or flagged for subagents.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
