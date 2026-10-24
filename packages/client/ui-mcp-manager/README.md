---
description: "Manage the profile's MCP servers from the Web sidebar: status, tools, add, edit, delete, enable, and reconnect."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-manager

English | [中文](README.zh.md)

## Summary

Use the **MCP** entry in the Web sidebar to see the profile's MCP servers with their connection status and tools. Add, edit, and delete servers, switch them on and off, and reconnect one that is retrying or stopped. The page drives the `mcp` Remote of [`dsh-mcp-manager`](../../mcp/mcp-manager/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select **MCP** in the sidebar, directly after **Plugins**. The entry and the `main` panel it opens share the id `mcp`. The page is global and belongs to no Session.

Each row of the list shows the server name, a status dot whose tone follows the state (disabled and not loaded are neutral, connecting and closing are in progress, connected is success, retrying is a warning, stopped is an error), the transport (stdio or Streamable HTTP), the ownership (**This profile**, **From a bundle**, or **Read-only**), the status text, and the tool count. A retrying row counts down the seconds to its next attempt. A switch on the row enables or disables the server; opening the row shows its detail.

The detail page shows the status with the attempt number while retrying, the last error of a retrying or stopped server, and the PID of an orphan process a stopped server may have left behind. It then shows the config summary (transport, command, arguments, and working directory, or the URL), the names of the stored environment variables or headers without their values, the server's name and version, and the tools it provides. Warnings from the last operation on the row appear under the tools.

### Adding and editing a server

**Add server** opens a form; **Edit** on the detail page opens the same form for the row. The server name takes letters, digits, `_`, and `-`, up to 32 characters. The transport selects the fields: a command with arguments (one per line) and working directory plus environment variables for stdio, or a URL plus headers for Streamable HTTP. **Advanced** holds the tool call timeout, fail on startup error, and automatic reconnection. Save stays disabled until the name is valid and the command or URL is present.

An edit sends only what the person changed. A field the row stores and the form did not touch is kept, so saving cannot lose it. Environment variable and header values are write-only: a stored entry reads **Saved; leave blank to keep** and is kept while its value stays blank, and typing a value replaces it. A field stored as a `!!js` expression shows its source and is either kept or replaced by a plain value through **Replace**; the form never edits the expression. Changing the transport drops the entered environment variables or headers. The page reports the Host's outcome: saved, saved but still overridden by a higher-priority layer, or taking effect after a restart. A rejected save keeps the form open with the reason.

A row inserted by a bundle can be edited, because the edit writes an override into the profile. A row the Host marks read-only, such as one Plugin Manager needs, has no **Edit**, and the page says why.

### Deleting a server

**Delete** appears only on rows this profile inserted. It asks for confirmation, then removes the row and every override that targets it. A bundle's row is switched off rather than deleted.

### Enabling and disabling

The row switch calls `pluginManager.setPluginEnabled` through Plugin Manager's Remote. When the assembly has no Plugin Manager, the switch is disabled with the tooltip **Plugin management is unavailable**; the page still lists, edits, deletes, and reconnects. A read-only row and a row with an operation in flight are locked too.

### Reconnecting a server

**Reconnect** is available for retrying, stopped, and not-loaded servers, and starts a fresh attempt. If the Host reports that a previous process may still be running, the page names its PID and asks to confirm; **Restart anyway** repeats the call with the orphan accepted, after which the old process may keep running and the person stops it.

### Refresh

The page lists the servers when the MCP panel is selected. After the page has been opened it also lists again on `mcp/change`, `plugin-manager/changed`, and `connection/reset`; those events are ignored before the first open. Every mutation lists again afterward, so the page shows the Host's own state. Leaving the panel returns the next visit to the list.

### Copy

All text comes from the `mcpManager` locale namespace, registered in Chinese and English. Server names, errors reported by servers, and tool names are shown as the Host sent them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser plugin injects `ctx.remote.mcp`, `locale`, `slots`, and `layout`, and registers the `sidebar.panellist` entry (order 1). It reads `ctx.remote.pluginManager` only if the assembly mounts it. The Host side is the registry in [`dsh-mcp-manager`](../../mcp/mcp-manager/README.md), which owns ownership, secrets, and the `McpChangeResult` outcomes.

<details>
<summary>Implementation internals — click to expand</summary>

### Registration

`apply()` registers the dictionaries, then a `main` slot entry keyed `mcp` with a navigation store (list, server, create, edit) and a `sidebar.panellist` entry. A subscription on the layout's active panel refreshes the catalog on entry and resets the navigation on exit. The change listeners are effects, so they dispose with the plugin.

### The catalog

`McpCatalog` lists through `mcp.list()`, coalesces overlapping lists, and runs every mutation as pending, outcome, clear pending, list again. It maps wire and operation error codes to locale keys; an `orphan-unacknowledged` error carries the PID for the confirmation. Enable and disable adapt the Plugin Manager result to the same outcome shape.

### The form model

`form-model.ts` turns a listed row into editable fields and back into an `McpServerDraft`. An untouched stored field becomes `{ keep: true }`, an untouched empty field is omitted, and an edited field sends its value. Arguments split on lines. The reconnect switch preserves the stored reconnect keys the form does not edit.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [mcp-manager](../../mcp/mcp-manager/README.md) — the Host registry and the `mcp` Remote this page drives.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page, beside which the MCP entry sits.
- [ui-sidebar](../ui-sidebar/README.md) — the panel list the MCP entry registers into; [ui-layout](../ui-layout/README.md) — the main slot the page occupies.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF and forwarded events behind the page.
- [locale](../locale/README.md) — the dictionary registration the copy uses.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side management surface that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request. A server added or changed here reaches a model only through the MCP tools the Host registers, and the cache behavior of those tools applies.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Values shown as stored** — `args` and URL query tokens appear in the detail page exactly as stored; only environment variable and header values are hidden. Put credentials in `env` or `headers`.
- **`!!js` values are kept or replaced** — an expression field cannot be edited in the form; the person keeps it or replaces it with a plain value.
- **Agent-scoped servers are not listed** — MCP rows declared for an Agent do not appear; the page lists the profile's rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
