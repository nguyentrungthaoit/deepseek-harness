/** Profile-owned configuration edits, serialized with Loader hot reload. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context, FiberState, Service, resolveConfig } from '@deepseek-ai/cordis'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import yaml from 'js-yaml'
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-hmr'
import { composeEntries, flattenEntries, loadProfileDirectory, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument, Scalar, visit, type Document, type YAMLSeq } from 'yaml'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent edits to the active profile's plugin configuration. */
    configEditor: ConfigEditor
  }
}

/** Profile-edit settings. */
export interface Config {
  /** Maximum time to wait for another writer's profile lock, in milliseconds. */
  lockWaitMs?: number
}

/** Persist complete raw configs and apply them through the normal Loader path. */
export class ConfigEditor extends Service {
  static inject = ['loader', 'profileContext']

  static Config: z<Config> = z.object({
    lockWaitMs: z.number().step(1).min(0).default(120000),
  })

  private readonly lockWaitMs: number

  constructor(private readonly ownerContext: Context, config: Config) {
    super(ownerContext, 'configEditor')
    this.lockWaitMs = (config as Required<Config>).lockWaitMs
  }

  /** The profile patch edited by this service. */
  get documentPath(): string { return this.ownerContext.profileContext.patchPath }

  /** Addressable profile rows; nested Includes have independent configuration ownership.
   * @returns Active entries with unique profile patch ids.
   */
  entries(): Entry[] {
    const candidates = [...this.ownerContext.loader.entries()].filter(entry => entry.parent.tree.ctx.fiber.entry?.id === 'include')
    const counts = new Map<string, number>()
    for (const entry of candidates) counts.set(entry.options.id, (counts.get(entry.options.id) ?? 0) + 1)
    return candidates.filter(entry => counts.get(entry.options.id) === 1)
  }

  /** Read inherited and explicit profile values for the active entries.
   * @returns Detached layer values alongside their Loader entries.
   */
  configuration(): Array<{ entry: Entry; inherited: Record<string, unknown>; override: Record<string, unknown> }> {
    const profile = this.ownerContext.profileContext
    const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
    const entries = this.entries()
    // An own config key can replace inherited config even when its value is undefined.
    const overridden = new Set(loaded.patches.filter(patch => patch.insert === undefined && Object.hasOwn(patch, 'config')).map(patch => patch.id))
    const composed = new Map<string, EntryOptions>()
    if (entries.some(entry => !overridden.has(entry.options.id))) {
      for (const row of flattenEntries(composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches]))) {
        if (!composed.has(row.id)) composed.set(row.id, row)
      }
    }
    return entries.map(entry => ({
      entry,
      inherited: overridden.has(entry.options.id)
        ? this.inherited(entry, loaded)
        : structuredClone((composed.get(entry.options.id)?.config ?? {}) as Record<string, unknown>),
      override: structuredClone((loaded.patches.findLast(
        row => row.id === entry.options.id && row.config !== undefined,
      )?.config ?? {}) as Record<string, unknown>),
    }))
  }

  private inherited(entry: Entry, loaded: ReturnType<typeof loadProfileDirectory>): Record<string, unknown> {
    const patches = loaded.patches.map((patch) => {
      if (patch.id !== entry.options.id || patch.insert !== undefined) return patch
      const rest = { ...patch }; Reflect.deleteProperty(rest, 'config')
      return rest
    })
    const row = flattenEntries(composeEntries([...loaded.layers.map(layer => layer.patches), patches]))
      .find(row => row.id === entry.options.id)
    return structuredClone((row?.config ?? {}) as Record<string, unknown>)
  }

  /** Validate, persist, and reconcile a plugin's next config; ordinary fields keep normal lifecycle rules.
   * @param entry Current Loader entry, also used to detect replacement during the write.
   * @param change Derive a raw config from the current entry and its inherited layer.
   * @returns Fulfillment after Loader reconciliation completes.
   */
  async edit(
    entry: Entry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    await this.exclusive(async () => {
      if (!this.entries().includes(entry) || entry.fiber === undefined) throw new Error('Configuration entry is no longer available')
      const beforePatches = await this.synchronize()
      if (!this.entries().includes(entry)) throw new Error('Configuration entry changed during reload')
      const current = structuredClone((entry.options.config ?? {}) as Record<string, unknown>)
      const inherited = this.inherited(entry, loadProfileDirectory('dsh', this.ownerContext.profileContext.dir, this.ownerContext.profileContext.installAnchor))
      const next = change(current, inherited)
      const fiber = entry.fiber
      if (fiber.state !== FiberState.ACTIVE) throw new Error('Configuration plugin is no longer active')
      const resolved: unknown = fiber.ctx.waterfall(fiber, 'internal/config', next, () => next)
      resolveConfig(fiber.runtime as NonNullable<typeof fiber.runtime>, resolved)
      await this.commit(beforePatches, (document, items) => {
        const index = items.findLastIndex((item, index) => isMap(item)
          && document.getIn([index, 'id']) === entry.options.id && !item.has('insert')
          && (!item.has('name') || document.getIn([index, 'name']) === entry.options.name))
        if (isDeepStrictEqual(next, inherited)) {
          for (let index = items.length - 1; index >= 0; index--) {
            const row = items[index]
            if (!isMap(row) || document.getIn([index, 'id']) !== entry.options.id || row.has('insert')) continue
            row.delete('config')
            if (row.items.length === Number(row.has('id')) + Number(row.has('name'))) document.delete(index)
          }
        } else if (index < 0) document.add(document.createNode({ id: entry.options.id, name: entry.options.name, config: next }))
        else document.setIn([index, 'config'], document.createNode(next))
        return [entry.options.id]
      }, (patches) => {
        const effective = flattenEntries(composeEntries([patches])).find(row => row.id === entry.options.id)
        if (!isDeepStrictEqual(effective?.config ?? {}, next)) {
          throw new Error(`Configuration for "${entry.options.id}" is overridden by a home patch or command-line overlay`)
        }
      })
    })
  }

  /** Rewrite the profile patch document, including inserting and removing rows, then reconcile the Loader.
   * A row that `change` inserts has no live Fiber yet, so its config is validated only by reconciliation: when a
   * required id fails to activate, the previous file and composition are restored and the failure is rethrown.
   * `__jsExpr` maps written by `change` become `!!js` scalars.
   * @param change Mutate the parsed, comment-preserving patch document and its top-level sequence items; returns the
   * row ids that must be active afterwards.
   * @returns Diagnostics for entries that remain inactive after reconciliation.
   */
  async rewrite(change: (document: Document.Parsed, items: YAMLSeq['items']) => readonly string[]): Promise<string[]> {
    return await this.exclusive(async () => await this.commit(await this.synchronize(), change))
  }

  /** Hold the profile file lock, then the HMR queue: the order Plugin Manager also takes them in. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    return withFileLock(join(this.ownerContext.profileContext.dir, 'package.json'), () => {
      const hmr = this.ownerContext.get('hmr')
      return hmr === undefined ? run() : hmr.runExclusive(run)
    }, { waitMs: this.lockWaitMs })
  }

  /** Apply the patch file on disk before deriving a change from the live Loader.
   * @returns The patches now applied, for rollback.
   */
  private async synchronize(): Promise<PatchOptions[]> {
    const patches = readProfilePatches('dsh', this.ownerContext.profileContext)
    await reconcileProfilePatches(this.ownerContext.root, patches, 'dsh')
    return patches
  }

  /** Persist one document change and reconcile it; restore the file and composition when reconciliation fails. */
  private async commit(
    beforePatches: PatchOptions[],
    change: (document: Document.Parsed, items: YAMLSeq['items']) => readonly string[],
    verify?: (patches: PatchOptions[]) => void,
  ): Promise<string[]> {
    const path = this.documentPath
    let before: string
    try { before = await readFile(path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      before = '[]\n'
    }
    const document = parseDocument(before, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    })
    if (document.errors[0] !== undefined) throw document.errors[0]
    if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
    document.contents.flow = false
    const requiredIds = change(document, document.contents.items)
    visit(document, { Map(_key, node) {
      if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
      const expression = new Scalar(node.get('__jsExpr'))
      expression.tag = 'tag:yaml.org,2002:js'
      return expression
    } })
    const profile = this.ownerContext.profileContext
    const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
    const patches = readProfilePatches('dsh', profile, { ...loaded, patches: yaml.load(String(document), { schema: entryListSchema }) as PatchOptions[] })
    verify?.(patches)
    await writeFileAtomic(path, String(document), { mode: 0o600 })
    try {
      return await reconcileProfilePatches(this.ownerContext.root, patches, 'dsh', requiredIds)
    } catch (error) {
      await writeFileAtomic(path, before, { mode: 0o600 })
      await reconcileProfilePatches(this.ownerContext.root, beforePatches, 'dsh')
      throw error
    }
  }
}

export default ConfigEditor
