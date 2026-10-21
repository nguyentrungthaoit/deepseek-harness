/**
 * Session-scoped skill catalog: list, write, and delete over `remote.skills`,
 * plus each session's Skills tab view.
 *
 * Writable rows carry the host's `body` and file `version`. A write or delete
 * sends that version back as `expectedVersion`; the host rejects a stale one
 * with `skills/conflict`, and the catalog then lists again. A write without a
 * `body` keeps the body on disk.
 */
import type {
  RemoteResult, SessionId, SkillEntry, SkillFileVersion, SkillWriteRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { createNavigationStore, reconcileView, type SkillView } from './navigation-store.ts'

/** One catalog row the panel can group and edit. */
export interface ManagedSkill {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly subagent: boolean
  readonly source: string
  readonly writable: boolean
  /** Markdown after frontmatter; absent when the host could not read it. */
  readonly body?: string
  /** File version of a writable row; sent back as `expectedVersion`. */
  readonly version?: SkillFileVersion
}

/** Fields the create and edit form submits. */
export interface SkillDraft {
  readonly name: string
  readonly description: string
  readonly subagent: boolean
  /** Omitted to keep the body on disk. */
  readonly body?: string
  readonly replaces?: string
  readonly expectedVersion?: SkillFileVersion
}

/** Why a write or delete failed. */
export interface SkillFailure {
  readonly message: string
  /** True when the file changed on disk after the row was listed. */
  readonly conflict: boolean
}

/** Published catalog for one session. */
export interface CatalogSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly skills: readonly ManagedSkill[]
  readonly message?: string
}

/** One session's catalog snapshot and Skills tab view; created and dropped together. */
export interface SessionStores {
  readonly catalog: SnapshotStore<CatalogSnapshot>
  readonly view: SnapshotStore<SkillView>
}

/** `ctx.remote.skills`. */
type SkillsRemote = TypertRemoteNamespaceMap['skills']

const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Whether `name` is a single kebab-case skill name.
 * @param name - trimmed name from the form.
 * @returns whether write may send it.
 */
export function isKebabName(name: string): boolean {
  return KEBAB_NAME.test(name)
}

/**
 * Split a catalog into editable and read-only rows, each ordered by name.
 * @param skills - the session catalog.
 * @returns the two groups the list renders.
 */
export function groupSkills(skills: readonly ManagedSkill[]): {
  readonly editable: readonly ManagedSkill[]
  readonly readonly: readonly ManagedSkill[]
} {
  const sorted = [...skills].sort((left, right) => left.name.localeCompare(right.name))
  return {
    editable: sorted.filter(skill => skill.writable),
    readonly: sorted.filter(skill => !skill.writable),
  }
}

/**
 * Read one list row.
 * @param entry - one `skills/list` row.
 * @returns the panel's row.
 */
export function toManagedSkill(entry: SkillEntry): ManagedSkill {
  return {
    name: entry.name,
    description: entry.description,
    ...entry.path === undefined ? {} : { path: entry.path },
    ...entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse },
    modelInvocable: entry.modelInvocable,
    subagent: entry.subagent,
    source: entry.source,
    writable: entry.writable,
    ...entry.body === undefined ? {} : { body: entry.body },
    ...entry.version === undefined ? {} : { version: entry.version },
  }
}

const IDLE: CatalogSnapshot = { status: 'idle', skills: [] }

/**
 * One plugin's catalogs, keyed by session.
 * The constructor captures the remote namespace; each session owns one
 * catalog snapshot and one view store.
 */
export class SkillCatalog {
  private readonly stores = new Map<SessionId, SessionStores>()
  private readonly inflight = new Map<SessionId, AbortController>()

  /**
   * @param skills - `ctx.remote.skills`.
   * @param isBound - whether a session still has a client binding; unbound sessions are forgotten.
   */
  constructor(
    private readonly skills: SkillsRemote,
    private readonly isBound: (sessionId: SessionId) => boolean,
  ) {}

  /**
   * The session's catalog and view stores. The first read starts a list;
   * sessions whose binding is gone are dropped first.
   * @param sessionId - session whose stores to publish.
   * @returns the stores the panel hooks bind.
   */
  source(sessionId: SessionId): SessionStores {
    for (const id of [...this.stores.keys()]) {
      if (id === sessionId || this.isBound(id)) continue
      this.inflight.get(id)?.abort()
      this.inflight.delete(id)
      this.stores.delete(id)
    }
    const stores = this.storesFor(sessionId)
    if (stores.catalog.getSnapshot().status === 'idle') void this.reload(sessionId)
    return stores
  }

  /**
   * List again for every session the panel has opened.
   */
  reloadAll(): void {
    for (const sessionId of this.stores.keys()) void this.reload(sessionId)
  }

  /**
   * List this session again, dropping a list still in flight.
   * @param sessionId - session to refresh.
   */
  reload(sessionId: SessionId): Promise<void> {
    this.inflight.get(sessionId)?.abort()
    const abort = new AbortController()
    this.inflight.set(sessionId, abort)
    const store = this.storesFor(sessionId).catalog
    if (store.getSnapshot().skills.length === 0) store.set({ status: 'loading', skills: [] })
    return this.fetch(sessionId, abort)
  }

  /**
   * Write one flat skill file.
   * @param sessionId - session whose project receives the file.
   * @param draft - form fields.
   * @returns a failure, or undefined when the write was accepted.
   */
  async write(sessionId: SessionId, draft: SkillDraft): Promise<SkillFailure | undefined> {
    const request: SkillWriteRequest = {
      sessionId,
      name: draft.name,
      description: draft.description,
      subagent: draft.subagent,
      ...draft.body === undefined ? {} : { body: draft.body },
      ...draft.replaces === undefined ? {} : { replaces: draft.replaces },
      ...draft.expectedVersion === undefined ? {} : { expectedVersion: draft.expectedVersion },
    }
    return this.settle(sessionId, () => this.skills.write(request))
  }

  /**
   * Delete one writable skill file.
   * @param sessionId - session whose project owns the file.
   * @param name - skill name.
   * @param expectedVersion - the row's version, when the host listed one.
   * @returns a failure, or undefined when the delete was accepted.
   */
  async remove(
    sessionId: SessionId,
    name: string,
    expectedVersion?: SkillFileVersion,
  ): Promise<SkillFailure | undefined> {
    const request = { sessionId, name, ...expectedVersion === undefined ? {} : { expectedVersion } }
    return this.settle(sessionId, () => this.skills.delete(request))
  }

  /** Abort every list still in flight and forget every session. */
  dispose(): void {
    for (const abort of this.inflight.values()) abort.abort()
    this.inflight.clear()
    this.stores.clear()
  }

  private storesFor(sessionId: SessionId): SessionStores {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const stores: SessionStores = { catalog: createSnapshotStore<CatalogSnapshot>(IDLE), view: createNavigationStore() }
    this.stores.set(sessionId, stores)
    return stores
  }

  private async fetch(sessionId: SessionId, abort: AbortController): Promise<void> {
    const { catalog: store, view } = this.storesFor(sessionId)
    try {
      const result = await this.skills.list({ sessionId }, abort.signal)
      if (abort.signal.aborted) return
      if (!result.ok) {
        store.set({ status: 'error', skills: store.getSnapshot().skills, message: result.error.message })
        return
      }
      const skills = result.value.skills.map(toManagedSkill)
      store.set({ status: 'ready', skills })
      const current = view.getSnapshot()
      const next = reconcileView(current, new Set(skills.map(skill => skill.name)))
      if (next !== current) view.set(next)
    } catch (error) {
      if (abort.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      store.set({ status: 'error', skills: store.getSnapshot().skills, message })
    } finally {
      if (this.inflight.get(sessionId) === abort) this.inflight.delete(sessionId)
    }
  }

  private async settle(
    sessionId: SessionId,
    run: () => Promise<RemoteResult<unknown>>,
  ): Promise<SkillFailure | undefined> {
    let result: RemoteResult<unknown>
    try {
      result = await run()
    } catch (error) {
      // Assembly faults reject; a host refusal arrives as `ok: false` below.
      return { message: error instanceof Error ? error.message : String(error), conflict: false }
    }
    if (!result.ok) {
      const conflict = result.error.code === 'skills/conflict'
      if (conflict) await this.reload(sessionId)
      return { message: result.error.message, conflict }
    }
    await this.reload(sessionId)
    return undefined
  }
}
