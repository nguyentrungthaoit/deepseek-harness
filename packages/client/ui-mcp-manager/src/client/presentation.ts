/** Pure presentation mapping for MCP server rows: status to tone and locale keys. */
import type { McpFailureReason, McpOwnership, McpServerStatus, McpTransport } from '@deepseek-ai/dsh-mcp-manager/types'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Visual tone of a status badge; maps onto the `StateDot` states (neutral=idle, progress=ongoing, success=done, warning, danger=error). */
export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger'

/** Locale keys of the primary status label. */
export type StatusKey =
  | 'status.disabled' | 'status.notLoaded' | 'status.connecting' | 'status.connected'
  | 'status.closing' | 'status.backoff' | 'status.failed'

/** Locale keys of a failed row's secondary detail. */
export type FailureKey = 'failure.reconnectDisabled' | 'failure.attemptsExhausted' | 'failure.closureUnconfirmed'

/** Locale keys naming who may change a row. */
export type OwnershipKey = 'ownership.profile' | 'ownership.layer' | 'ownership.readonly'

/** Locale keys naming a transport. */
export type TransportKey = 'transport.stdio' | 'transport.http'

/** A locale key with its interpolation parameters. */
export interface LabelRef<K extends string> {
  readonly key: K
  readonly params?: Readonly<Record<string, string | number>>
}

/** Primary status label; `detail` is present only for `failed` and names the failure reason. */
export interface StatusLabel extends LabelRef<StatusKey> {
  readonly detail?: LabelRef<FailureKey>
}

/**
 * Pick the badge tone for a status.
 * @param status - the server row status.
 * @returns the tone.
 */
export function statusTone(status: McpServerStatus): Tone {
  switch (status.state) {
    case 'disabled':
    case 'not-loaded':
      return 'neutral'
    case 'connecting':
    case 'closing':
      return 'progress'
    case 'connected':
      return 'success'
    case 'backoff':
      return 'warning'
    case 'failed':
      return 'danger'
    default:
      return assertNever(status)
  }
}

/**
 * Map a failure reason to its detail key.
 * @param reason - why the supervisor stopped connecting.
 * @returns the failure locale key.
 */
function failureKey(reason: McpFailureReason): FailureKey {
  switch (reason) {
    case 'reconnect-disabled': return 'failure.reconnectDisabled'
    case 'attempts-exhausted': return 'failure.attemptsExhausted'
    case 'closure-unconfirmed': return 'failure.closureUnconfirmed'
    default: return assertNever(reason)
  }
}

/**
 * Build the status label. `backoff` carries `{attempt, maxAttempts, seconds}` with seconds
 * rounded up and clamped at zero; `connecting` carries `{attempt}`; `failed` adds a `detail`
 * naming the reason.
 * @param status - the server row status.
 * @param now - current epoch milliseconds, for the backoff countdown.
 * @returns the locale key, parameters, and optional failure detail.
 */
export function statusLabel(status: McpServerStatus, now: number): StatusLabel {
  switch (status.state) {
    case 'disabled': return { key: 'status.disabled' }
    case 'not-loaded': return { key: 'status.notLoaded' }
    case 'connecting': return { key: 'status.connecting', params: { attempt: status.attempt } }
    case 'connected': return { key: 'status.connected' }
    case 'closing': return { key: 'status.closing' }
    case 'backoff':
      return {
        key: 'status.backoff',
        params: {
          attempt: status.attempt,
          maxAttempts: status.maxAttempts,
          seconds: Math.max(0, Math.ceil((status.retryAt - now) / 1000)),
        },
      }
    case 'failed': return { key: 'status.failed', detail: { key: failureKey(status.reason) } }
    default: return assertNever(status)
  }
}

/**
 * Map ownership to its locale key.
 * @param ownership - who may change the row.
 * @returns the locale key.
 */
export function ownershipKey(ownership: McpOwnership): OwnershipKey {
  switch (ownership) {
    case 'profile': return 'ownership.profile'
    case 'layer': return 'ownership.layer'
    case 'readonly': return 'ownership.readonly'
    default: return assertNever(ownership)
  }
}

/**
 * Map a transport to its locale key.
 * @param transport - the configured transport.
 * @returns the locale key.
 */
export function transportKey(transport: McpTransport): TransportKey {
  switch (transport) {
    case 'stdio': return 'transport.stdio'
    case 'streamable-http': return 'transport.http'
    default: return assertNever(transport)
  }
}

/**
 * Whether a manual reconnect is meaningful in this status.
 * @param status - the server row status.
 * @returns true for backoff, failed, and not-loaded.
 */
export function canReconnect(status: McpServerStatus): boolean {
  return status.state === 'backoff' || status.state === 'failed' || status.state === 'not-loaded'
}
