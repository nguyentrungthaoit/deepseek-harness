/**
 * MCP server status and management types: the status Service Definition that
 * `dsh-mcp-client` connections implement, and the `mcp` Remote vocabulary.
 * @module @deepseek-ai/dsh-mcp-manager/types
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { RedactedSecret } from '@deepseek-ai/dsh-settings'

/** Why a supervised connection stopped connecting on its own. */
export type McpFailureReason = 'reconnect-disabled' | 'attempts-exhausted' | 'closure-unconfirmed'

/**
 * Live connection state reported by a provider. `closing` is a failed attempt
 * waiting for its transport to report closure; `orphanPid` names a stdio
 * child whose shutdown could not be confirmed.
 */
export type McpConnectionStatus =
  | { state: 'connecting'; attempt: number }
  | { state: 'connected'; since: number }
  | { state: 'closing' }
  | { state: 'backoff'; attempt: number; maxAttempts: number; retryAt: number; lastError?: string }
  | { state: 'failed'; reason: McpFailureReason; lastError?: string; orphanPid?: number }

/** One server row's state: a disabled row, an enabled row with no live provider, or the provider's own state. */
export type McpServerStatus = { state: 'disabled' } | { state: 'not-loaded' } | McpConnectionStatus

/** One discovered tool as status consumers see it. */
export interface McpToolView {
  rawName: string
  publicName: string
  title?: string
  description: string
}

/** Name and version the server reported during initialization. */
export interface McpServerInfo {
  name: string
  version: string
}

/** Result of a provider's manual retry. */
export type McpRetryOutcome = 'started' | 'busy' | 'disposed' | 'needs-restart'

/** Transport selected by one server row. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Live status of one connection, implemented by `dsh-mcp-client`. */
export interface McpServerStatusProvider {
  /** Configured server namespace. */
  readonly serverName: string
  /** Configured transport. */
  readonly transport: McpTransport
  /**
   * Read the supervisor state.
   * @returns the current phase with its attempt, timing, and failure details.
   */
  status(): McpConnectionStatus
  /**
   * Read the registered tool generation.
   * @returns the listed tools, empty while no generation is registered.
   */
  tools(): readonly McpToolView[]
  /**
   * Read the identity of the last connected server.
   * @returns the reported name and version, or undefined before the first connection.
   */
  serverInfo(): McpServerInfo | undefined
  /**
   * Observe status, tool, and orphan changes.
   * @param listener - called synchronously after each change.
   * @returns a function that stops the observation.
   */
  subscribe(listener: () => void): () => void
  /**
   * Start a fresh attempt budget from backoff or a stopped state.
   * @returns whether an attempt started, or why it did not.
   */
  retry(): McpRetryOutcome
}

/** The registration half of the status seam, the only part providers depend on. */
export interface McpServerRegistration {
  /**
   * Register one connection for the Loader entry that owns it. Registrations
   * from an Agent scope, or without an entry id, are ignored.
   * @param entryId - raw Loader entry id of the registering plugin.
   * @param provider - the connection's live status.
   * @returns the effect disposer for this registration.
   */
  register(entryId: string | undefined, provider: McpServerStatusProvider): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live status of root-scoped MCP server connections and Web management of their profile rows. */
    mcpServers: McpServerRegistration
  }
}

/** Server identity on the wire: the Loader entry id Plugin Manager also uses. */
export type McpServerId = PluginEntryId

/** Who may change a server row. */
export type McpOwnership = 'profile' | 'layer' | 'readonly'

/** Why a server row cannot be changed through the profile patch. */
export type McpReadOnlyReason = 'management-required' | 'unaddressable'

/** A configured value, or the source of a `!!js` expression that produced it. */
export type McpFieldView<T> = T | { expression: string }

/** Reconnect policy fields as stored on the row. */
export interface McpReconnectView {
  enabled?: boolean
  initialDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
}

/** Non-secret fields shared by both transports. */
interface McpCommonConfigView {
  serverName: string
  toolCallTimeoutMs?: McpFieldView<number>
  failOnStartupError?: McpFieldView<boolean>
  reconnect?: McpFieldView<McpReconnectView>
}

/** Stored row config without secret values; secret positions are listed beside it. */
export type McpServerConfigView =
  | McpCommonConfigView & { transport: 'stdio'; command: McpFieldView<string>; args?: McpFieldView<string[]>; cwd?: McpFieldView<string> }
  | McpCommonConfigView & { transport: 'streamable-http'; url: McpFieldView<string> }

/** One server row as the Web screen reads it. */
export interface McpServerView {
  entryId: McpServerId
  /** Profile patch row id, present when the row is addressable. */
  patchId?: string
  serverName: string
  transport: McpTransport
  enabled: boolean
  ownership: McpOwnership
  readOnlyReason?: McpReadOnlyReason
  config: McpServerConfigView
  /** Secret `env` or `headers` positions and whether each holds a value; values never cross the wire. */
  secrets: readonly RedactedSecret[]
  status: McpServerStatus
  tools: readonly McpToolView[]
  serverInfo?: McpServerInfo
}

/** Current server rows. */
export interface McpServerListValue {
  servers: McpServerView[]
}

/** Keep the stored value, including a `!!js` expression. */
export interface McpKeep {
  keep: true
}

/** A secret entry: keep the stored value or write a new one. */
export type McpSecretInput = McpKeep | { value: string }

/** A field: keep the stored value or write a new one. */
export type McpFieldInput<T> = T | McpKeep

/** Draft fields shared by both transports. */
interface McpCommonDraft {
  serverName: string
  toolCallTimeoutMs?: McpFieldInput<number>
  failOnStartupError?: McpFieldInput<boolean>
  reconnect?: McpFieldInput<McpReconnectView>
}

/** A server row to create or the complete next state of one; omitted secret keys are removed. */
export type McpServerDraft =
  | McpCommonDraft & {
    transport: 'stdio'
    command: McpFieldInput<string>
    args?: McpFieldInput<string[]>
    cwd?: McpFieldInput<string>
    env?: Record<string, McpSecretInput>
  }
  | McpCommonDraft & {
    transport: 'streamable-http'
    url: McpFieldInput<string>
    headers?: Record<string, McpSecretInput>
  }

/** Why a management operation did not apply. */
export type McpChangeErrorCode =
  | 'name-conflict' | 'read-only' | 'invalid-config' | 'not-active' | 'orphan-unacknowledged' | 'operation-error'

/** Outcome of one management operation. */
export interface McpChangeResult {
  entryId?: McpServerId
  /** `overridden` when a higher-priority layer replaced the saved value; `restart-required` without HMR. */
  application: 'applied' | 'overridden' | 'restart-required' | 'failed'
  /**
   * Notices of earlier processes whose shutdown could not be confirmed, secret values removed;
   * other rows' activation diagnostics are not included.
   */
  warnings: string[]
  error?: { code: McpChangeErrorCode; diagnostic?: string; orphanPid?: number }
}

/** Options of a reconnect request. */
export interface McpReconnectOptions {
  /** Restart even though the previous child process may still run. */
  acceptOrphan?: boolean
}

/** What changed among the server rows. */
export interface McpServerChange {
  entryId?: McpServerId
  reason: 'status' | 'tools' | 'config' | 'registration'
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A server row's status, tools, or configuration changed, or a connection registered or left.
     * @mode emit
     * @param change - the affected row, when one is known, and what changed.
     */
    'mcp/change'(change: McpServerChange): void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No MCP server row carries that entry id. */
    'mcp/not-found': { readonly entryId: string }
  }
}
