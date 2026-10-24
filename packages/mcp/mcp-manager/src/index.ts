/** Web management of MCP server rows: live status, tools, and profile-patch edits. */
import { isDeepStrictEqual } from 'node:util'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, flattenEntries, loadProfileDirectory, readProfilePatches, resolveEntryOwnership } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-hmr'
import { pluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { allocatePatchId, insertServerRow, MCP_CLIENT, removeServerRow, replaceServerConfig } from './patch.ts'
import { maskConfig, mergeDraft, scrub, secretValues } from './secrets.ts'
import type {
  McpChangeErrorCode, McpChangeResult, McpOwnership, McpReconnectOptions, McpServerChange, McpServerDraft, McpServerId,
  McpServerListValue, McpServerRegistration, McpServerStatus, McpServerStatusProvider, McpServerView,
} from './types.ts'
export type * from './types.ts'

type Raw = Record<string, unknown>

/** One MCP row with what the registry needs beyond its wire view. */
interface ServerRow {
  view: McpServerView
  entry: Entry
  raw: Raw
  secretValues: string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A failed result; the thrown cause is scrubbed of secret values by the caller. */
class ChangeFailure extends Error {
  constructor(readonly code: McpChangeErrorCode, message: string, readonly orphanPid?: number) {
    super(message)
    this.name = 'ChangeFailure'
  }
}

/** Which Loader rows are MCP server rows. */
export interface Config {
  /** Module specifiers that load `dsh-mcp-client`; the first names the rows this registry creates. */
  moduleNames?: string[]
}

/** Live status of root-scoped MCP connections and the `mcp` Remote that edits their profile rows. */
export class McpServerRegistry extends TypertRemoteService implements McpServerRegistration {
  static inject = ['loader', 'profileContext', 'configEditor']
  static Config: z<Config> = z.object({
    moduleNames: z.array(z.string().required()).min(1).default([MCP_CLIENT]),
  })
  private readonly owner: Context
  private readonly moduleNames: readonly string[]
  /** Registered providers by raw Loader entry id. */
  private readonly providers = new Map<string, McpServerStatusProvider>()
  /** Child PIDs a disposal could not confirm closed, by raw Loader entry id, until reported once. */
  private readonly orphans = new Map<string, number>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'mcpServers', { namespace: 'mcp' })
    this.owner = ctx
    this.moduleNames = (config as Required<Config>).moduleNames
  }

  register(entryId: string | undefined, provider: McpServerStatusProvider): () => void {
    const ctx = this.ctx
    if (entryId === undefined || scopeOf(ctx) !== undefined) return () => {}
    const dispose = ctx.effect(() => {
      if (this.providers.has(entryId)) throw new Error(`MCP server entry "${entryId}" is already registered`)
      this.providers.set(entryId, provider)
      const unsubscribe = provider.subscribe(() => {
        const status = provider.status()
        if (status.state === 'failed' && status.orphanPid !== undefined) this.orphans.set(entryId, status.orphanPid)
        this.changed({ entryId: pluginEntryId(entryId), reason: 'status' })
      })
      this.changed({ entryId: pluginEntryId(entryId), reason: 'registration' })
      return () => {
        unsubscribe()
        this.providers.delete(entryId)
        this.changed({ entryId: pluginEntryId(entryId), reason: 'registration' })
      }
    }, `mcpServers.register(${provider.serverName})`)
    // oxlint-disable-next-line typescript/no-misused-promises -- unregistration is synchronous; Cordis retains pending fiber disposal
    return dispose
  }

  /**
   * Read every MCP server row of the profile with its live status.
   * @returns rows without secret values.
   */
  @Remote
  list(): Promise<McpServerListValue> {
    return Promise.resolve({ servers: this.rows().map(row => row.view) })
  }

  /**
   * Insert a server row into the profile patch and start it.
   * @param draft - the row to create; `keep` inputs are refused because nothing is stored yet.
   * @returns the saved and runtime outcome.
   */
  @Remote
  async create(draft: McpServerDraft): Promise<McpChangeResult> {
    const config = mergeDraft(draft, {})
    return await this.change([], async (result) => {
      const rows = this.rows()
      if (rows.some(row => row.view.serverName === draft.serverName)) {
        throw new ChangeFailure('name-conflict', `serverName "${draft.serverName}" is already used`)
      }
      const taken = new Set([
        ...flattenEntries(composeEntries([readProfilePatches('dsh', this.owner.profileContext)])).map(row => row.id),
        ...[...this.owner.loader.entries()].map(entry => entry.options.id),
      ])
      const id = allocatePatchId(draft.serverName, taken)
      result.warnings = await this.rewrite((document) => {
        insertServerRow(document, id, this.moduleNames[0] as string, config)
        return [id]
      })
      // Reconciliation required this id to activate, so its entry exists.
      const entry = [...this.owner.loader.entries()].find(row => row.options.id === id) as Entry
      result.entryId = pluginEntryId(entry.id)
    })
  }

  /**
   * Replace the complete config of a server row.
   * @param entryId - the row's Loader entry id.
   * @param draft - the next config; `keep` inputs copy stored values, omitted secrets are removed.
   * @returns the saved and runtime outcome; `overridden` when a higher-priority layer still decides the value.
   */
  @Remote
  async update(entryId: McpServerId, draft: McpServerDraft): Promise<McpChangeResult> {
    const row = this.find(entryId)
    const config = mergeDraft(draft, row.raw)
    return await this.change(row.secretValues, async (result) => {
      result.entryId = entryId
      const patchId = this.writable(row, ['profile', 'layer'])
      if (draft.serverName !== row.view.serverName && this.rows().some(other => other.view.serverName === draft.serverName)) {
        throw new ChangeFailure('name-conflict', `serverName "${draft.serverName}" is already used`)
      }
      const ownership = row.view.ownership as 'profile' | 'layer'
      result.warnings = await this.rewrite((document, items) => {
        replaceServerConfig(document, items, patchId, row.entry.options.name, config, ownership)
        return row.view.enabled ? [patchId] : []
      })
      const effective = flattenEntries(composeEntries([readProfilePatches('dsh', this.owner.profileContext)]))
        .find(candidate => candidate.id === patchId)
      if (!isDeepStrictEqual(effective?.config, config)) result.application = 'overridden'
    })
  }

  /**
   * Remove a server row the profile inserted, with its overrides.
   * @param entryId - the row's Loader entry id.
   * @returns the saved and runtime outcome; layer rows are read-only here.
   */
  @Remote
  async removeServer(entryId: McpServerId): Promise<McpChangeResult> {
    const row = this.find(entryId)
    return await this.change(row.secretValues, async (result) => {
      result.entryId = entryId
      const patchId = this.writable(row, ['profile'])
      result.warnings = await this.rewrite((document, items) => {
        removeServerRow(document, items, patchId)
        return []
      })
    })
  }

  /**
   * Start a fresh connection attempt, restarting the plugin when its connection cannot retry on its own.
   * @param entryId - the row's Loader entry id.
   * @param options - `acceptOrphan` restarts although a previous child process may still run.
   * @returns the runtime outcome.
   */
  @Remote
  async reconnect(entryId: McpServerId, options?: McpReconnectOptions): Promise<McpChangeResult> {
    const row = this.find(entryId)
    return await this.change(row.secretValues, async (result) => {
      result.entryId = entryId
      if (!row.view.enabled) throw new ChangeFailure('not-active', 'the server row is disabled')
      const provider = this.providers.get(row.entry.id)
      const outcome = provider?.retry() ?? 'needs-restart'
      if (outcome === 'busy' || outcome === 'disposed') throw new ChangeFailure('not-active', `the connection is ${row.view.status.state}`)
      if (outcome === 'started') return
      const status = row.view.status
      const orphanPid = status.state === 'failed' ? status.orphanPid : undefined
      if (orphanPid !== undefined && options?.acceptOrphan !== true) {
        throw new ChangeFailure('orphan-unacknowledged', `process ${String(orphanPid)} may still run`, orphanPid)
      }
      const hmr = this.owner.get('hmr')
      const fiber = row.entry.fiber
      if (hmr === undefined || fiber === undefined) {
        result.application = 'restart-required'
        return
      }
      await hmr.runExclusive(() => fiber.restart())
      result.warnings = this.drainOrphans()
    })
  }

  private changed(change: McpServerChange): void {
    this.owner.emit('mcp/change', change)
  }

  /**
   * Save through the config editor, then report disposals that left a child process running. A saved row that
   * fails to activate is refused as `invalid-config`, so the inactive entries reconciliation still lists belong to
   * other rows of the profile and are not this server's warnings.
   */
  private async rewrite(change: Parameters<Context['configEditor']['rewrite']>[0]): Promise<string[]> {
    try {
      await this.owner.configEditor.rewrite(change)
    } catch (error) {
      // reconcileProfilePatches reports a required row that failed to activate as "... did not activate".
      if (messageOf(error).includes('did not activate')) throw new ChangeFailure('invalid-config', messageOf(error))
      throw error
    }
    this.changed({ reason: 'config' })
    return this.drainOrphans()
  }

  private drainOrphans(): string[] {
    const warnings = [...this.orphans.values()].map(pid => `MCP server process ${String(pid)} could not be confirmed stopped and may still run`)
    this.orphans.clear()
    return warnings
  }

  /** Run one operation and fold any failure into a failed result; validation before it runs propagates as a wire error. */
  private async change(secrets: readonly string[], operation: (result: McpChangeResult) => Promise<void>): Promise<McpChangeResult> {
    const result: McpChangeResult = { application: 'applied', warnings: [] }
    try {
      await operation(result)
    } catch (error) {
      const failure = error instanceof ChangeFailure ? error : new ChangeFailure('operation-error', messageOf(error))
      result.application = 'failed'
      result.error = {
        code: failure.code, diagnostic: scrub(failure.message, secrets),
        ...failure.orphanPid === undefined ? {} : { orphanPid: failure.orphanPid },
      }
    }
    result.warnings = result.warnings.map(warning => scrub(warning, secrets))
    return result
  }

  private find(entryId: McpServerId): ServerRow {
    const row = this.rows().find(candidate => candidate.view.entryId === entryId)
    if (row === undefined) throw new RemoteError('mcp/not-found', `no MCP server row "${entryId}"`, { entryId })
    return row
  }

  private writable(row: ServerRow, allowed: readonly McpOwnership[]): string {
    if (row.view.patchId === undefined || !allowed.includes(row.view.ownership)) {
      throw new ChangeFailure('read-only', `the server row is ${row.view.readOnlyReason ?? row.view.ownership}-owned`)
    }
    return row.view.patchId
  }

  private rows(): ServerRow[] {
    const profile = this.owner.profileContext
    const rows = flattenEntries(composeEntries([readProfilePatches('dsh', profile)]))
    const own = loadProfileDirectory('dsh', profile.dir, profile.installAnchor).patches
    const inserted = new Set(own.flatMap(patch => patch.insert ?? []).map(row => row.id))
    const entries = [...this.owner.loader.entries()].filter(entry => this.moduleNames.includes(entry.options.name))
    const owned = resolveEntryOwnership(
      entries.map(entry => ({ entryId: entry.id, moduleName: entry.options.name, entry })),
      rows, this.owner.loader.entries(), { protectedModules: new Set() },
    )
    return owned.map((item) => {
      const { entry } = item
      const raw = (rows.find(row => row.id === entry.options.id)?.config ?? {}) as Raw
      const resolved = entry.fiber?.config as Raw | undefined
      const provider = this.providers.get(entry.id)
      const info = provider?.serverInfo()
      const serverName = provider?.serverName ?? String(resolved?.serverName ?? raw.serverName)
      const values = secretValues(raw, resolved)
      const { config, secrets } = maskConfig(raw, serverName)
      const enabled = !entry.disabled
      const ownership: McpOwnership = 'patchId' in item ? inserted.has(item.patchId) ? 'profile' : 'layer' : 'readonly'
      const view: McpServerView = {
        entryId: pluginEntryId(entry.id), serverName, transport: config.transport, enabled, ownership,
        ...'patchId' in item ? { patchId: item.patchId } : { readOnlyReason: item.readOnlyReason },
        config, secrets, status: this.status(enabled, provider, values),
        tools: provider?.tools() ?? [],
        ...info === undefined ? {} : { serverInfo: info },
      }
      return { view, entry, raw, secretValues: values }
    })
  }

  private status(enabled: boolean, provider: McpServerStatusProvider | undefined, values: readonly string[]): McpServerStatus {
    if (!enabled) return { state: 'disabled' }
    if (provider === undefined) return { state: 'not-loaded' }
    const status = provider.status()
    if ((status.state === 'backoff' || status.state === 'failed') && status.lastError !== undefined) {
      return { ...status, lastError: scrub(status.lastError, values) }
    }
    return status
  }
}

export default McpServerRegistry
