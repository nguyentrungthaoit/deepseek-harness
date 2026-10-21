---
description: "Right Sidebar tab that lists, creates, and edits the session project's skills, and inserts /name into the composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-manager

English | [中文](README.zh.md)

## Summary

List, create, and edit this Session's project skills from the right Sidebar. Use in chat appends `/name ` to the unsent draft.

## Table of Contents

- [What it registers](#what-it-registers)
- [Pages](#pages)
- [Navigation](#navigation)
- [The catalog](#the-catalog)
- [The toast](#toast)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

A guide gives way to the Skills page. The page is session scoped and claims no resource address.

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `skills`, id `@deepseek-ai/dsh-client-ui-skill-manager`, band `builtin`, no patterns, and one guide entry (order 15, its title and description from the `skillManager` namespace).
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id. It shows one page at a time: the list, one skill's detail, the edit form, or the create form. Skills are grouped as Editable (`writable`) and Read-only; an empty group is hidden.
- **The toast** — a `shell.overlay` entry with id `skill-manager.toast`.
- **The chip title** — the keyed `sidebar.right.pane.tab.title` seat under that id.

Use in chat emits `conversation/input-append-text` on the Session scope with `{ text: '/' + name + ' ' }`. The conversation input hub appends that text at the end of the draft.

The package injects `@deepseek-ai/dsh-client-ui-layout` for the `shell.overlay` seat. It builds its cards, modal, and switches from `@deepseek-ai/dsh-client-ui-primitives` and promotes nothing to it.

Source files under `src/client/`: `definition.tsx` (the type), `catalog.ts` (list, write, and delete), `navigation-store.ts` (the per-session page), `Panel.tsx` (the body that routes the page), `SkillList.tsx`, `SkillDetail.tsx`, and `SkillForm.tsx` (the pages), `SkillParts.tsx` (the rendered content and the Subagent row the detail page and form share), `subagent-switch.ts` (the Subagent write), `SkillToast.tsx` (the toast), `Title.tsx` (the chip title), `locales.ts` (copy), and `index.ts` (the wiring).

<a id="pages"></a>
## Pages

- **List.** The header has the title, an info tooltip, Refresh, and New skill. Each card opens the skill's detail through one name button whose `::after` covers the card; the insert button and the Subagent switch sit above that layer, so no interactive element nests in another. Tab order per card is name, insert, switch. The insert button is shown on hover or focus and always on a coarse pointer. Under the description, a read-only card shows its `source` as a tag and a card whose Subagent is on shows a Subagent badge. With more than five skills, a search field under the header filters cards by name and description; when nothing matches, the list says so. The first load shows a skeleton; a load error shows a notice with Retry, inline when rows exist and centered when none do. An empty catalog shows one sentence and New skill.
- **Detail.** A "‹ Skills" breadcrumb, then a header with the icon, name, `source` and Subagent on/off chips, the description, and the actions: Use in chat for every skill and Edit and Delete for writable ones. Sections are content (writable only), source and path, and for writable skills the Subagent switch with its help text. Content is rendered as Markdown in a document card; code blocks and wide tables scroll inside the card. A writable skill whose body could not be read shows a notice and its Edit button is disabled. Delete opens a modal; confirming sends the row's `version` as `expectedVersion`.
- **Form.** Name (kebab-case), description, Subagent, and content. Each field has one line under it that shows help and is replaced by the field's error, so errors never move the layout. Content switches between Write, a monospace textarea that grows with its text up to a maximum height, and Preview, which renders the Markdown as the detail page does. A rename sends `replaces`.

<a id="navigation"></a>
## Navigation

Each session has its own navigation store beside its catalog; both are dropped together when the session loses its binding. Closing and reopening the tab in the same session returns to the same page. When a listing no longer contains the skill on the detail page, the tab returns to the list. An open edit form keeps what was typed and shows that the skill was deleted or renamed; saving then creates it. A successful save opens the saved skill's detail page, which follows a rename to the new name.

<a id="the-catalog"></a>
## The catalog

`remote.skills.list` loads the session catalog. `skills/change` on `ctx.remote` lists every opened session again. This package does not read the slash-menu cache. Create and edit call `remote.skills.write` with a kebab-case name, description, subagent flag, markdown body, and the row's `version` as `expectedVersion`. Renaming sends `replaces`. Delete calls `remote.skills.delete` with `expectedVersion`. The subagent switch sends no body, so the host keeps the file's body and its other frontmatter keys. A `kind` in an existing file's `metadata` is neither read nor changed. On `skills/conflict` the panel reloads the catalog. An open form keeps its content and shows an error, and saving again uses the new version; a conflict from the Subagent switch or Delete reports through the toast.

<a id="toast"></a>
## The toast

The registration owns one notice store, and the `skill-manager.toast` overlay entry renders it, so an outcome stays visible after the tab closes. It reports success and failure of save, delete, and the Subagent switch, and a conflict. Running states are not reported. A failed delete keeps the card, and a failed switch returns to its listed value.

<a id="model-experience"></a>
## Model Experience

None, as this package draws a session skills panel in the browser and registers nothing model-facing.

#### KV Cache effect

None; catalog reads and writes travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Flat files.** Write stores one `<name>.md`. Nested skill directories are not edited here.
- **Unreadable bodies.** A row that arrives without a body cannot be edited; the Edit button is disabled. The subagent switch still works because it sends no body.
- **Always-apply guidance.** A skill loads on `/name` or a model call and never applies itself to every turn. Guidance that must always apply belongs in `AGENTS.md` or `CLAUDE.md`, which this panel does not edit.
- **Read-only sources.** A row with `writable: false` can be inserted into the composer and cannot be edited, deleted, or flagged for subagents.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
