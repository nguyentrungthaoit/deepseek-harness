/** Secret-free projections of stored MCP rows, draft merging, and diagnostic scrubbing. */
import z from '@deepseek-ai/schemastery'
import { redactSecrets, type RedactedSecret } from '@deepseek-ai/dsh-settings'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { McpFieldView, McpSecretInput, McpServerConfigView, McpServerDraft } from './types.ts'

/**
 * The secret positions of `dsh-mcp-client`'s Config. This package never loads
 * the client, so the fragment repeats its `role('secret')` declarations; a test
 * compares both.
 */
export const SECRET_FIELDS = z.object({
  env: z.dict(z.string().role('secret')),
  headers: z.dict(z.string().role('secret')),
})

/** Shortest secret value replaced in diagnostics; shorter strings would mask ordinary text. */
const MIN_SCRUBBED_LENGTH = 4

/** Text that replaces a secret value in diagnostics. */
export const MASK = '•••'

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A stored `!!js` value, as the profile patch reader represents it. */
function expressionOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.__jsExpr === 'string' && Object.keys(value).length === 1 ? value.__jsExpr : undefined
}

function view<T>(value: unknown): McpFieldView<T> {
  const expression = expressionOf(value)
  return expression === undefined ? value as T : { expression }
}

/** Copy the fields present on the stored row into a view. */
function present(raw: Raw, keys: readonly string[]): Raw {
  const out: Raw = {}
  for (const key of keys) if (raw[key] !== undefined) out[key] = view(raw[key])
  return out
}

/**
 * Project one stored row without secret values.
 * @param raw - the row's effective stored config, `!!js` values as `{ __jsExpr }` maps.
 * @param serverName - the resolved server namespace.
 * @returns the secret-free config view and the secret positions it held.
 */
export function maskConfig(raw: Raw, serverName: string): { config: McpServerConfigView; secrets: RedactedSecret[] } {
  const { secrets } = redactSecrets(SECRET_FIELDS as z<never>, raw)
  const common = present(raw, ['toolCallTimeoutMs', 'failOnStartupError', 'reconnect'])
  const config = raw.transport === 'streamable-http'
    ? { ...common, transport: 'streamable-http', serverName, ...present(raw, ['url']) }
    : { ...common, transport: 'stdio', serverName, ...present(raw, ['command', 'args', 'cwd']) }
  return { config: config as McpServerConfigView, secrets }
}

function badRequest(message: string): RemoteError<'gateway/bad-request'> {
  return new RemoteError('gateway/bad-request', message, {})
}

function isKeep(value: unknown): value is { keep: true } {
  return isRecord(value) && value.keep === true && Object.keys(value).length === 1
}

type Check = (value: unknown) => boolean
const isString: Check = value => typeof value === 'string'
const isNumber: Check = value => typeof value === 'number' && Number.isFinite(value)
const isBoolean: Check = value => typeof value === 'boolean'
const isStringList: Check = value => Array.isArray(value) && value.every(isString)
const isReconnect: Check = value => isRecord(value) && Object.entries(value).every(([key, entry]) =>
  key === 'enabled' ? isBoolean(entry) : ['initialDelayMs', 'maxDelayMs', 'maxAttempts'].includes(key) && isNumber(entry))

/** Resolve one field draft against the stored row. */
function field(name: string, input: unknown, stored: Raw, check: Check, out: Raw): void {
  if (input === undefined) return
  if (isKeep(input)) {
    if (stored[name] === undefined) throw badRequest(`${name} has no stored value to keep`)
    out[name] = stored[name]
    return
  }
  if (!check(input)) throw badRequest(`${name} has an invalid value`)
  out[name] = input
}

/** Refuse a draft that omits a field its transport requires; drafts arrive over the wire untyped. */
function required(name: string, value: unknown): void {
  if (value === undefined) throw badRequest(`${name} is required`)
}

/** Resolve one secret dictionary draft against the stored row; omitted keys are removed. */
function secretMap(name: 'env' | 'headers', input: Record<string, McpSecretInput> | undefined, stored: Raw, out: Raw): void {
  if (input === undefined) return
  if (!isRecord(input)) throw badRequest(`${name} must be an object`)
  const previous = isRecord(stored[name]) ? stored[name] : {}
  const next: Raw = {}
  for (const [key, entry] of Object.entries(input)) {
    if (isKeep(entry)) {
      if (previous[key] === undefined) throw badRequest(`${name}.${key} has no stored value to keep`)
      next[key] = previous[key]
    } else if (isRecord(entry) && typeof entry.value === 'string' && Object.keys(entry).length === 1) {
      next[key] = entry.value
    } else {
      throw badRequest(`${name}.${key} must be { keep: true } or { value: string }`)
    }
  }
  out[name] = next
}

/**
 * Build the next stored row config from a Web draft.
 * @param draft - the wire draft; validated here because it crosses the wire.
 * @param stored - the row's current stored config, empty for a new row.
 * @returns the raw config to persist, with kept values copied from `stored` unchanged.
 */
export function mergeDraft(draft: McpServerDraft, stored: Raw): Raw {
  if (!isRecord(draft)) throw badRequest('draft must be an object')
  if (typeof draft.serverName !== 'string') throw badRequest('serverName must be a string')
  const out: Raw = { transport: draft.transport, serverName: draft.serverName }
  field('toolCallTimeoutMs', draft.toolCallTimeoutMs, stored, isNumber, out)
  field('failOnStartupError', draft.failOnStartupError, stored, isBoolean, out)
  field('reconnect', draft.reconnect, stored, isReconnect, out)
  switch (draft.transport) {
    case 'stdio':
      required('command', draft.command)
      field('command', draft.command, stored, isString, out)
      field('args', draft.args, stored, isStringList, out)
      field('cwd', draft.cwd, stored, isString, out)
      secretMap('env', draft.env, stored, out)
      return out
    case 'streamable-http':
      required('url', draft.url)
      field('url', draft.url, stored, isString, out)
      secretMap('headers', draft.headers, stored, out)
      return out
    default:
      throw badRequest('transport must be stdio or streamable-http')
  }
}

/** Collect literal strings of one secret dictionary. */
function collect(source: unknown, into: Set<string>): void {
  if (!isRecord(source)) return
  for (const value of Object.values(source)) {
    if (typeof value === 'string' && value.length >= MIN_SCRUBBED_LENGTH) into.add(value)
  }
}

/**
 * Gather every secret value a diagnostic could repeat.
 * @param stored - stored row config; literal `env`/`headers` values.
 * @param resolved - the live plugin config, where `!!js` secrets hold their computed values.
 * @returns the values to mask, longest first.
 */
export function secretValues(stored: Raw, resolved: Raw | undefined): string[] {
  const values = new Set<string>()
  for (const source of [stored, resolved]) {
    if (source === undefined) continue
    collect(source.env, values)
    collect(source.headers, values)
  }
  return [...values].sort((a, b) => b.length - a.length)
}

/**
 * Replace secret values in diagnostic text.
 * @param text - diagnostic that may repeat a configured secret.
 * @param values - values from {@link secretValues}.
 * @returns the text with each value replaced by {@link MASK}.
 */
export function scrub(text: string, values: readonly string[]): string {
  return values.reduce((current, value) => current.split(value).join(MASK), text)
}
