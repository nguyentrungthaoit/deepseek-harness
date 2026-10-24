/**
 * Form state for creating or editing one MCP server row. A field the row
 * already stores and the user did not touch is sent as `{ keep: true }`, so
 * stored values, `!!js` expressions, and secrets survive a save unchanged;
 * only edited fields carry new values.
 */
import type {
  McpFieldInput, McpFieldView, McpKeep, McpReconnectView, McpSecretInput, McpServerDraft, McpServerView, McpTransport,
} from '@deepseek-ai/dsh-mcp-manager/types'

/** One editable field and what the row stored for it. */
export interface Field<T> {
  value: T
  /** The row stores a value for this field. */
  stored: boolean
  /** Source of the stored `!!js` expression, shown instead of a value. */
  expression?: string
  /** The user changed the value in this form. */
  dirty: boolean
}

/** One `env` or `headers` entry. */
export interface SecretRow {
  key: string
  /** The row stores a value the browser never sees. */
  stored: boolean
  /** New value; blank keeps a stored value. */
  value: string
}

/** Every value the form edits. */
export interface FormState {
  transport: McpTransport
  serverName: string
  command: Field<string>
  args: Field<string>
  cwd: Field<string>
  url: Field<string>
  secrets: SecretRow[]
  toolCallTimeoutMs: Field<string>
  failOnStartupError: Field<boolean>
  reconnectEnabled: Field<boolean>
  /** Stored reconnect policy keys this form does not edit, kept when the switch changes. */
  reconnectBase: McpReconnectView
}

/** A form problem, named by its locale key. */
export type FormProblem = 'form.serverNameHint' | 'form.command' | 'form.url'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

function field<T, S>(stored: McpFieldView<S> | undefined, fallback: T, show: (value: S) => T): Field<T> {
  if (stored === undefined) return { value: fallback, stored: false, dirty: false }
  if (typeof stored === 'object' && stored !== null && 'expression' in stored) {
    return { value: fallback, stored: true, expression: stored.expression, dirty: false }
  }
  return { value: show(stored), stored: true, dirty: false }
}

/**
 * Start the form from a listed row, or empty for a new row.
 * @param view - the row being edited; absent when creating.
 * @returns the initial state.
 */
export function initialForm(view?: McpServerView): FormState {
  const config = view?.config
  const stdio = config?.transport === 'stdio' ? config : undefined
  const http = config?.transport === 'streamable-http' ? config : undefined
  const transport: McpTransport = config?.transport ?? 'stdio'
  const secretField = transport === 'stdio' ? 'env' : 'headers'
  const reconnect = field<boolean, McpReconnectView>(config?.reconnect, true, value => value.enabled ?? true)
  return {
    transport,
    serverName: view?.serverName ?? '',
    command: field(stdio?.command, '', String),
    args: field<string, string[]>(stdio?.args, '', value => value.join('\n')),
    cwd: field(stdio?.cwd, '', String),
    url: field(http?.url, '', String),
    secrets: (view?.secrets ?? [])
      .filter(secret => secret.path[0] === secretField && secret.path.length === 2)
      .map(secret => ({ key: secret.path[1] as string, stored: secret.set, value: '' })),
    toolCallTimeoutMs: field(config?.toolCallTimeoutMs, '', String),
    failOnStartupError: field(config?.failOnStartupError, false, Boolean),
    reconnectEnabled: reconnect,
    reconnectBase: typeof config?.reconnect === 'object' && !('expression' in config.reconnect) ? config.reconnect : {},
  }
}

/**
 * Record one user edit.
 * @param current - the field before the edit.
 * @param value - the new value.
 * @returns the edited field; an expression becomes a plain value once replaced.
 */
export function edit<T>(current: Field<T>, value: T): Field<T> {
  return { value, stored: current.stored, dirty: true }
}

/** Untouched stored fields keep; untouched empty fields are omitted; edited fields send their value. */
function input<T, W>(current: Field<T>, wire: (value: T) => W | undefined): McpFieldInput<W> | undefined {
  if (!current.dirty) return current.stored ? KEEP : undefined
  return wire(current.value)
}

const KEEP: McpKeep = { keep: true }

const text = (value: string): string | undefined => value.trim() === '' ? undefined : value.trim()

function secretInputs(rows: readonly SecretRow[]): Record<string, McpSecretInput> | undefined {
  const entries = rows
    .filter(row => row.key.trim() !== '' && (row.stored || row.value !== ''))
    .map((row): [string, McpSecretInput] => [row.key.trim(), row.stored && row.value === '' ? KEEP : { value: row.value }])
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/**
 * Find what blocks a save.
 * @param state - the current form.
 * @returns the first problem, or undefined when the form can be saved.
 */
export function problem(state: FormState): FormProblem | undefined {
  if (!SERVER_NAME.test(state.serverName.trim())) return 'form.serverNameHint'
  const required = state.transport === 'stdio' ? state.command : state.url
  const present = required.dirty ? text(required.value) !== undefined : required.stored
  if (!present) return state.transport === 'stdio' ? 'form.command' : 'form.url'
  return undefined
}

/**
 * Build the Remote draft; call only when {@link problem} returns undefined.
 * @param state - the current form.
 * @returns the draft for `create` or `update`.
 */
export function toDraft(state: FormState): McpServerDraft {
  const common = {
    serverName: state.serverName.trim(),
    ...optional('toolCallTimeoutMs', input(state.toolCallTimeoutMs, (value) => {
      const parsed = Number(value)
      return value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed
    })),
    ...optional('failOnStartupError', input(state.failOnStartupError, value => value)),
    ...optional('reconnect', input(state.reconnectEnabled, (value): McpReconnectView => ({ ...state.reconnectBase, enabled: value }))),
  }
  const secrets = secretInputs(state.secrets)
  if (state.transport === 'stdio') {
    return {
      ...common, transport: 'stdio',
      // problem() refused a missing command, so the input is present.
      command: input(state.command, text) as McpFieldInput<string>,
      ...optional('args', input(state.args, value => value.split('\n').map(line => line.trim()).filter(line => line !== ''))),
      ...optional('cwd', input(state.cwd, text)),
      ...optional('env', secrets),
    }
  }
  return { ...common, transport: 'streamable-http', url: input(state.url, text) as McpFieldInput<string>, ...optional('headers', secrets) }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]: V }
}
