# Agent Note: Web management of MCP server rows

Status: implemented

English | [中文](2026-10-21-web-mcp-server-management.zh.md)

## Problem

A person who wants an MCP server in a profile edits YAML by hand or installs a configuration-only bundle. Nothing shows whether a configured server is connected, which tools it registered, or why it stopped retrying; the `mcp-client` supervisor kept that state private. Editing the YAML also exposes `env` and `headers` secrets to anyone reading the file in a browser-based editor.

## Decision

The Web client has an MCP panel backed by a status seam and an `mcp` Remote. `dsh-mcp-client` reports each root-scoped connection to `ctx.mcpServers` through `register(entryId, provider)`: the supervisor phase (`connecting`, `connected`, `closing`, `backoff`, `failed`), the last attempt error, the registered tools, the server identity, and the PID of a stdio child whose shutdown could not be confirmed. `dsh-mcp-manager` owns the Service Definition and the registry; it never imports the client, so the client's dependency on it is type-only and optional.

The registry lists every Loader row whose module is an MCP client (`moduleNames`, default `@deepseek-ai/dsh-mcp-client`) and joins it with the profile composition. A row the profile inserted is edited in place; a row from a bundle layer is edited through an override row and cannot be deleted; a row the profile patch cannot address is read-only. Enablement stays with Plugin Manager's `setPluginEnabled`, so a server row and a plugin row have one toggle path. Writes go through `ConfigEditor.rewrite`, which holds the profile file lock and then the HMR queue in the same order as Plugin Manager and restores the file and composition when a required row fails to activate.

### Secrets

`env` and `headers` are `role('secret')` values. List views carry only the secret positions that `redactSecrets` reports; drafts carry `{ keep: true }` or `{ value }` per key, and a kept value, including a `!!js` expression, is copied from the stored row unchanged. Diagnostics returned to the browser have stored literals and the resolved values of `!!js` secrets replaced. The same declaration makes generic Settings surfaces treat these fields as write-only.

### Reconnect

A manual reconnect asks the connection to start a fresh attempt budget, which it refuses while connecting, connected, or closing. After a close that could not be confirmed, or when the plugin never loaded, the registry restarts the Loader fiber under HMR. When a child PID is known the restart requires `acceptOrphan`, and the registry reports the PID instead of killing it: the PID may already belong to another process.

### Threat model

Creating a stdio row runs a command on the Host. This is the trust level of installing a plugin through Plugin Manager: only an authenticated Web session reaches the Remote, and no new privilege is introduced.

## Alternatives considered

**A configuration-only bundle per server.** The [persistent plugin management decision](../architecture/2026-09-16-creator-persistent-plugin-management.md) uses it for prompt-driven installation, and it stays the model-facing path. For a person it hides status, forces a package install for a config edit, and puts secrets in a file the browser shows.

**Enable and disable in the MCP registry.** It would duplicate Plugin Manager's override-row semantics and give one row two toggle paths that could disagree.

**Key status by `serverName`.** Agent-scoped instances may reuse a name in another Agent, so the Loader entry id is the only identity that is unique and survives saves.

**Restart the fiber for every reconnect.** A restart unregisters every tool, cancels calls in flight, and blocks HMR for a whole connect; the supervisor's own retry avoids all three when it is safe.

**Kill an orphaned child by PID.** PIDs are reused and the platform kill semantics differ; reporting the PID leaves the decision to the person.

## Consequences

People see and fix MCP servers without editing YAML, and secrets no longer reach the browser. A save waits for the new server's first connection attempt while holding the profile lock, so a slow server delays other profile writers up to the editor's `lockWaitMs`. `args`, URL userinfo and query tokens are not masked, the client's own log lines can repeat a raw error, and Agent- or preset-scoped rows are not listed. A restart after an unconfirmed close can leave the previous process running.
