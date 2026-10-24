/**
 * MCP server catalog: list, create, update, remove, reconnect, and enable over
 * `remote.mcp` and the optional `remote.pluginManager`, with per-row pending
 * state, the last operation's outcome, and a coalesced refresh.
 *
 * Every mutation sets its row pending, stores the outcome, clears pending, and
 * then lists again so the panel always shows the Host's own state.
 */
import type { ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  McpChangeErrorCode, McpChangeResult, McpReconnectOptions, McpServerDraft, McpServerView,
} from '@deepseek-ai/dsh-mcp-manager/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'

/** Locale keys a failure can map to. */
export type McpErrorKey =
  | 'error.nameConflict' | 'error.readOnly' | 'error.invalidConfig' | 'error.notActive'
  | 'error.orphanUnacknowledged' | 'error.operationError' | 'error.notFound' | 'error.badRequest'

/** What a row is waiting on. */
export type McpPending = 'saving' | 'removing' | 'reconnecting' | 'toggling'

/** The last operation's outcome, kept for the panel's notice. */
export interface McpLastResult {
  readonly entryId?: string
  readonly application: McpChangeResult['application']
  readonly warnings: readonly string[]
  readonly errorCode?: McpChangeErrorCode
}

/** Published catalog state. */
export interface McpCatalogSnapshot {
  readonly phase: 'loading' | 'ready' | 'failed'
  readonly servers: readonly McpServerView[]
  /** Locale key of the last list failure; absent after a successful list. */
  readonly error?: McpErrorKey
  readonly pending: Readonly<Record<string, McpPending>>
  readonly lastResult?: McpLastResult
}

/**
 * What a mutation returned to its caller: `unavailable` (no Plugin Manager),
 * `rejected` (the Host refused on the wire), or `completed` with the operation
 * result, `errorKey` set when it failed. An `orphan-unacknowledged` error
 * carries `orphanPid` for the confirm modal.
 */
export type McpOutcome =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected'; readonly errorKey: McpErrorKey }
  | { readonly kind: 'completed'; readonly result: McpChangeResult; readonly errorKey?: McpErrorKey }

type McpRemote = TypertRemoteNamespaceMap['mcp']
type PluginManagerRemote = TypertRemoteNamespaceMap['pluginManager']

type Settled =
  | { readonly ok: true; readonly value: McpChangeResult }
  | { readonly ok: false; readonly error: { readonly code: string } }

const CHANGE_ERROR_KEYS: Readonly<Record<McpChangeErrorCode, McpErrorKey>> = {
  'name-conflict': 'error.nameConflict',
  'read-only': 'error.readOnly',
  'invalid-config': 'error.invalidConfig',
  'not-active': 'error.notActive',
  'orphan-unacknowledged': 'error.orphanUnacknowledged',
  'operation-error': 'error.operationError',
}

/**
 * Map a wire error code to a locale key.
 * @param code - the RemoteError code.
 * @returns the locale key.
 */
export function wireErrorKey(code: string): McpErrorKey {
  if (code === 'mcp/not-found') return 'error.notFound'
  if (code === 'gateway/bad-request') return 'error.badRequest'
  return 'error.operationError'
}

/**
 * Map an operation error code to a locale key.
 * @param code - the McpChangeResult error code.
 * @returns the locale key.
 */
export function changeErrorKey(code: McpChangeErrorCode): McpErrorKey {
  return CHANGE_ERROR_KEYS[code]
}

/**
 * Read a Plugin Manager result as an MCP operation result.
 * @param entryId - the toggled row.
 * @param result - the Plugin Manager's outcome.
 * @returns the equivalent result; `cancelled` and any error read as failed.
 */
function fromPluginResult(entryId: string, result: ChangeResult): McpChangeResult {
  const failed = result.error !== undefined || result.application === 'failed' || result.application === 'cancelled'
  const diagnostic = result.error?.diagnostic
  return {
    entryId: entryId as McpServerView['entryId'],
    application: failed ? 'failed' : result.application as McpChangeResult['application'],
    warnings: result.warnings ?? [],
    ...failed
      ? { error: { code: 'operation-error' as const, ...diagnostic === undefined ? {} : { diagnostic } } }
      : {},
  }
}

/**
 * Summarise an outcome for the panel's notice.
 * @param entryId - the row the call targeted, when it had one.
 * @param outcome - what the call returned.
 * @returns the stored last result.
 */
function toLast(entryId: string | undefined, outcome: McpOutcome): McpLastResult {
  if (outcome.kind !== 'completed') {
    return { ...entryId === undefined ? {} : { entryId }, application: 'failed', warnings: [], errorCode: 'operation-error' }
  }
  const { result } = outcome
  const id = result.entryId ?? entryId
  return {
    ...id === undefined ? {} : { entryId: id },
    application: result.application,
    warnings: result.warnings,
    ...result.error === undefined ? {} : { errorCode: result.error.code },
  }
}

/** Controller behind the MCP panel. */
export class McpCatalog {
  private readonly store: SnapshotStore<McpCatalogSnapshot> = createSnapshotStore<McpCatalogSnapshot>({
    phase: 'loading', servers: [], pending: {},
  })
  private running: Promise<void> | undefined
  private followUp: Promise<void> | undefined

  /**
   * @param mcp - `ctx.remote.mcp`.
   * @param pluginManager - `ctx.remote.pluginManager`, absent when Plugin Manager is not installed.
   */
  constructor(private readonly mcp: McpRemote, private readonly pluginManager?: PluginManagerRemote) {}

  /** The subscribable snapshot store. */
  get snapshots(): SnapshotStore<McpCatalogSnapshot> {
    return this.store
  }

  /** Whether enable and disable can reach the Host. */
  get canToggle(): boolean {
    return this.pluginManager !== undefined
  }

  /**
   * List the servers. A call during a list in flight schedules one follow-up
   * list that every such call shares.
   * @returns a promise settled when the list this call asked for has finished.
   */
  refresh(): Promise<void> {
    if (this.running === undefined) return this.start()
    this.followUp ??= this.running.then(() => {
      this.followUp = undefined
      return this.start()
    })
    return this.followUp
  }

  /**
   * Add a server row.
   * @param draft - the new row.
   * @returns the outcome.
   */
  create(draft: McpServerDraft): Promise<McpOutcome> {
    return this.mutate(undefined, 'saving', () => this.mcp.create(draft))
  }

  /**
   * Replace a server row's config.
   * @param entryId - the row.
   * @param draft - the complete next state.
   * @returns the outcome.
   */
  update(entryId: string, draft: McpServerDraft): Promise<McpOutcome> {
    return this.mutate(entryId, 'saving', () => this.mcp.update(entryId as McpServerView['entryId'], draft))
  }

  /**
   * Delete a server row.
   * @param entryId - the row.
   * @returns the outcome.
   */
  remove(entryId: string): Promise<McpOutcome> {
    return this.mutate(entryId, 'removing', () => this.mcp.removeServer(entryId as McpServerView['entryId']))
  }

  /**
   * Reconnect a server.
   * @param entryId - the row.
   * @param options - `acceptOrphan` after the orphan confirmation.
   * @returns the outcome.
   */
  reconnect(entryId: string, options?: McpReconnectOptions): Promise<McpOutcome> {
    return this.mutate(entryId, 'reconnecting', () => this.mcp.reconnect(entryId as McpServerView['entryId'], options))
  }

  /**
   * Enable or disable a server row through Plugin Manager.
   * @param entryId - the row.
   * @param enabled - the wanted state.
   * @returns the outcome, `unavailable` when Plugin Manager is absent.
   */
  async setEnabled(entryId: string, enabled: boolean): Promise<McpOutcome> {
    const manager = this.pluginManager
    if (manager === undefined) return { kind: 'unavailable' }
    return this.mutate(entryId, 'toggling', async (): Promise<Settled> => {
      const result = await manager.setPluginEnabled(entryId as McpServerView['entryId'], enabled)
      return result.ok ? { ok: true, value: fromPluginResult(entryId, result.value) } : result
    })
  }

  private start(): Promise<void> {
    // A follow-up starts only after this run has cleared, so `running` is never replaced early.
    this.running = this.load().finally(() => { this.running = undefined })
    return this.running
  }

  private async load(): Promise<void> {
    let key: McpErrorKey
    try {
      const result = await this.mcp.list()
      if (result.ok) {
        const { error: _cleared, ...rest } = this.store.getSnapshot()
        this.store.set({ ...rest, phase: 'ready', servers: result.value.servers })
        return
      }
      key = wireErrorKey(result.error.code)
    } catch {
      key = 'error.operationError'
    }
    this.store.set({ ...this.store.getSnapshot(), phase: 'failed', error: key })
  }

  private setPending(entryId: string | undefined, kind: McpPending | undefined): void {
    if (entryId === undefined) return
    const snapshot = this.store.getSnapshot()
    const { [entryId]: _dropped, ...rest } = snapshot.pending
    this.store.set({ ...snapshot, pending: kind === undefined ? rest : { ...rest, [entryId]: kind } })
  }

  private async mutate(
    entryId: string | undefined,
    kind: McpPending,
    run: () => Promise<Settled>,
  ): Promise<McpOutcome> {
    this.setPending(entryId, kind)
    let outcome: McpOutcome
    try {
      const result = await run()
      outcome = result.ok
        ? {
          kind: 'completed',
          result: result.value,
          ...result.value.error === undefined ? {} : { errorKey: changeErrorKey(result.value.error.code) },
        }
        : { kind: 'rejected', errorKey: wireErrorKey(result.error.code) }
    } catch {
      outcome = { kind: 'rejected', errorKey: 'error.operationError' }
    }
    this.setPending(entryId, undefined)
    this.store.set({ ...this.store.getSnapshot(), lastResult: toLast(entryId, outcome) })
    await this.refresh()
    return outcome
  }
}
