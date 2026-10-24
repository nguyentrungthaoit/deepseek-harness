---
description: "Status seam for MCP server connections and the Web `mcp` Remote that lists, creates, edits, removes, and reconnects server rows in the profile patch."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-manager

English | [中文](README.zh.md)

## Summary

`dsh-mcp-manager` defines the MCP status seam, `ctx.mcpServers`, and implements the registry behind the `mcp` Remote that the Web MCP screen uses. [`dsh-mcp-client`](../mcp-client/README.md) registers each root-scoped connection with its live state and tools. The Remote lists server rows with that state, creates, updates, and removes rows in the profile patch, and starts a fresh connection attempt. Environment and header values never leave the Host. Creating a stdio server runs a command on the Host.

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

Mount `McpServerRegistry` once in the profile. It requires `loader`, `profileContext`, and `configEditor`; HMR is optional but decides whether edits apply to the running composition.

| Field | Default | Meaning |
|---|---|---|
| `moduleNames` | `['@deepseek-ai/dsh-mcp-client']` | Module specifiers whose Loader entries are MCP server rows. The first names the module of rows that `create` inserts. |

### Status seam

The package is the Service Definition of a capability seam; `dsh-mcp-client` is its Service Provider and the `mcp` Remote is its Consumer. A provider implements `McpServerStatusProvider`, which reports the connection state, discovered tools, and server identity, notifies subscribers of changes, and answers `retry()` with `started`, `busy`, `disposed`, or `needs-restart`. It calls `ctx.mcpServers.register(entryId, provider)` with the raw Loader entry id and receives the effect disposer. A registration from an Agent scope or without an entry id is ignored, and registering the same entry id twice fails. Status changes emit `mcp/change` with reason `status`; registration and removal emit `registration`; a completed save emits `config`.

### Remote methods

The `mcp` Remote namespace exposes these methods to authenticated Web sessions. A row's identity is its Loader entry id, `McpServerId`.

| Method | Behavior |
|---|---|
| `list()` | Every MCP server row of the profile with its configuration, secret positions, live status, tools, and server identity. |
| `create(draft)` | Inserts a new row into the profile patch under an unused `mcp-<serverName>` id and waits for it to activate. |
| `update(entryId, draft)` | Replaces the row's complete configuration. |
| `removeServer(entryId)` | Removes a row the profile inserted, with every override that targets it. |
| `reconnect(entryId, options?)` | Starts a fresh connection attempt. |

`create`, `update`, `removeServer`, and `reconnect` return `McpChangeResult`. Its `application` is `applied`, `overridden` when a higher-priority layer still decides the saved value, `restart-required` when no HMR can apply the change, or `failed`. `warnings` carries notices of earlier processes whose shutdown could not be confirmed; inactive entries of other rows in the profile are not reported, and a saved row that fails to activate is `invalid-config`. A failure sets `error.code` to one of `name-conflict`, `read-only`, `invalid-config`, `not-active`, `orphan-unacknowledged`, or `operation-error`, with a diagnostic and, for an unconfirmed process, `orphanPid`. A server name already used by another row is `name-conflict`.

A request for an entry id with no row fails as a wire error `mcp/not-found`. A draft that is not an object, has no valid transport, omits `command` or `url`, holds a mistyped field, or uses `keep` where nothing is stored fails as `gateway/bad-request`, before any file changes.

### Ownership

Each row has an ownership class. `profile` rows are inserted by the profile's own patch; `update` and `removeServer` edit them in place. `layer` rows are inserted by a lower-priority layer; `update` writes an override in the profile patch, and `remove` is refused. `readonly` rows cannot be addressed in the profile patch, with `readOnlyReason` `management-required` or `unaddressable`, and every edit is refused as `read-only`. A row's `patchId` is present when it is addressable.

Enabling and disabling a row is not a method here. [Plugin Manager](../../boot/plugin-manager/README.md) owns it through `pluginManager.setPluginEnabled`; this package reports `enabled` and `disabled` status and refuses `reconnect` on a disabled row as `not-active`.

### Secrets

Values of `env` (stdio) and `headers` (Streamable HTTP) never leave the Host. A view lists each secret position and whether it holds a value. A draft writes each position as `{ keep: true }`, which copies the stored value, or `{ value }`, which writes a new one. The draft is the complete next state, so omitted keys are removed. Other fields accept `{ keep: true }` as well.

A value stored as `!!js` appears in `config` as `{ expression }` with its source and is kept verbatim by `{ keep: true }`; it can only be kept or replaced with a literal. Diagnostics, warnings, and the last error in a status replace every stored literal and every resolved secret value of at least four characters with `•••`.

### Saving and reconnecting

Every save goes through `configEditor.rewrite`, which takes the profile file lock, then enters the HMR queue, edits the patch in a comment-preserving transform, and waits for reconciliation. A call therefore returns after the new or changed server's first connection attempt settles. A saved row that fails to activate is reported as `invalid-config`.

`reconnect` first calls the provider's `retry()`. `started` finishes the call; `busy` and `disposed` fail as `not-active`. For `needs-restart`, or when no provider is loaded, the plugin restarts through `fiber.restart()` in the HMR queue. If the previous attempt failed with an `orphanPid`, the call fails as `orphan-unacknowledged` until the caller passes `acceptOrphan: true`. Without HMR the result is `restart-required`. Restarting reports any process that could not be confirmed stopped as a warning.

### Threat model

Creating a stdio server runs its command on the Host with the Host user's permissions. This carries the same trust as installing a plugin through [Plugin Manager](../../boot/plugin-manager/README.md): the Remote is callable only by an authenticated Web session and grants no privilege that session lacks.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpServerRegistry`: provider map, Remote methods, row projection, and change results |
| [`src/types.ts`](src/types.ts) | Status seam types, wire views and drafts, `mcp/change`, and the `mcp/not-found` error |
| [`src/secrets.ts`](src/secrets.ts) | Secret-free row views, draft merging and validation, and diagnostic scrubbing |
| [`src/patch.ts`](src/patch.ts) | Comment-preserving profile patch edits and patch id allocation |

Rows come from the composed profile patches, the loaded Loader entries whose module is in `moduleNames`, and the app-boot ownership resolution. A row reads its secrets from the stored config and, for scrubbing, from the live plugin config, where `!!js` values hold their computed result. `SECRET_FIELDS` repeats the `role('secret')` positions of the client's Config because this package never loads the client; a test compares both.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — connections, transports, and the provider that registers here.
- [Plugin Manager](../../boot/plugin-manager/README.md) — enabling and disabling rows, and plugin installation.
- [Config editor](../../boot/config-editor/README.md) — the serialized profile patch rewrite that saves go through.

<a id="model-experience"></a>
## Model Experience

None, as the package reports connection state to the Web screen and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; a saved row change reloads its `dsh-mcp-client` entry, whose tools and instructions then follow that package's behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `args` and the userinfo or query tokens of a URL are not masked in views, and scrubbing covers only `env` and `headers` values.
- `dsh-mcp-client` writes its own log lines, which can repeat raw errors that contain secrets; scrubbing applies to this package's results only.
- Rows scoped to an Agent or preset are not listed; only root-scoped Loader entries appear.
- A save holds the profile lock until the new server's first connection attempt settles, so a slow server delays other profile edits.
- Restarting after an unconfirmed close can leave the previous process running. The PID is reported and the process is never killed.
- `!!js` values can only be kept or replaced with a literal; they cannot be edited as expressions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
