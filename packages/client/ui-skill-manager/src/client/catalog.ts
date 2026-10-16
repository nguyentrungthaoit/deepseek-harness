/**
 * Session-scoped skill catalog: list, write, and delete over `remote.skills`.
 *
 * Extra list fields (`kind`, `subagent`, `source`, `writable`, `body`) are read
 * from each row when the host supplies them. A missing `kind` counts as a skill.
 * Bodies last written here fill a later list row that omits `body`, so a
 * subagent toggle can send the same markdown back.
 */
import type { RemoteResult, SessionId, SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One catalog row the panel can group and edit. */
export interface ManagedSkill {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly kind: 'rule' | 'skill'
  readonly subagent: boolean
  readonly source: string
  readonly writable: boolean
  /** Markdown after frontmatter, when the list or a save in this panel supplied it. */
  readonly body?: string
}

/** Fields the create and edit form submits. */
export interface SkillDraft {
  readonly name: string
  readonly description: string
  readonly kind: 'rule' | 'skill'
  readonly subagent: boolean
  readonly body: string
  readonly replaces?: string
}

/** Published catalog for one session. */
export interface CatalogSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly skills: readonly ManagedSkill[]
  readonly message?: string
}

/** Write and delete as the host remote declares them, viewed locally until the generated client includes them. */
interface SkillMutations {
  write(request: SkillWriteRequest, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  delete(request: SkillDeleteRequest, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

/** `skills/write` request. */
interface SkillWriteRequest {
  readonly sessionId: SessionId
  readonly name: string
  readonly description: string
  readonly kind: 'rule' | 'skill'
  readonly subagent: boolean
  readonly body: string
  readonly replaces?: string
}

/** `skills/delete` request. */
interface SkillDeleteRequest {
  readonly sessionId: SessionId
  readonly name: string
}

/** Optional fields a list row may carry before the generated `SkillEntry` includes them. */
type SkillExtras = {
  readonly kind?: 'rule' | 'skill'
  readonly subagent?: boolean
  readonly source?: string
  readonly writable?: boolean
  readonly body?: string
}

const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Stable failure when the remote namespace does not yet expose write and delete. */
export const SKILL_MUTATIONS_UNAVAILABLE = 'unavailable'

/**
 * Whether `name` is a single kebab-case skill name.
 * @param name - trimmed name from the form.
 * @returns whether write may send it.
 */
export function isKebabName(name: string): boolean {
  return KEBAB_NAME.test(name)
}

/**
 * Split a catalog into Rules and everything else, each ordered by name.
 * @param skills - the session catalog.
 * @returns the two groups the panel renders.
 */
export function groupSkills(skills: readonly ManagedSkill[]): {
  readonly rules: readonly ManagedSkill[]
  readonly skills: readonly ManagedSkill[]
} {
  const rules: ManagedSkill[] = []
  const rest: ManagedSkill[] = []
  for (const skill of skills) {
    if (skill.kind === 'rule') rules.push(skill)
    else rest.push(skill)
  }
  const byName = (left: ManagedSkill, right: ManagedSkill): number => left.name.localeCompare(right.name)
  rules.sort(byName)
  rest.sort(byName)
  return { rules, skills: rest }
}

/** One list row, including fields a generated `SkillEntry` may not declare yet. */
type ListedRow = {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
} & SkillExtras

/**
 * Read one list row, including fields the generated entry may not declare yet.
 * @param entry - one `skills/list` row.
 * @returns the panel's row.
 */
export function toManagedSkill(entry: ListedRow): ManagedSkill {
  const row: ListedRow = entry
  const body = typeof row.body === 'string' ? row.body : undefined
  return {
    name: row.name,
    description: row.description,
    ...row.path === undefined ? {} : { path: row.path },
    ...row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse },
    modelInvocable: row.modelInvocable,
    kind: row.kind === 'rule' ? 'rule' : 'skill',
    subagent: row.subagent === true,
    source: typeof row.source === 'string' ? row.source : '',
    writable: row.writable === true,
    ...body === undefined ? {} : { body },
  }
}

function isFunctionMember(value: object, key: 'write' | 'delete'): boolean {
  // `in` sees class methods; Reflect.get reads them without assuming the generated client already declares write and delete.
  return key in value && typeof Reflect.get(value, key) === 'function'
}

function hasMutations(value: object): value is SkillMutations {
  return isFunctionMember(value, 'write') && isFunctionMember(value, 'delete')
}

const IDLE: CatalogSnapshot = { status: 'idle', skills: [] }

/** The list face this panel needs from `ctx.remote.skills`, plus write and delete when the host exposes them. */
interface SkillsRemote {
  list(
    request: { readonly sessionId: SessionId },
    signal?: AbortSignal,
  ): Promise<RemoteResult<{ readonly skills: readonly SkillEntry[] }>>
  write?(request: SkillWriteRequest, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  delete?(request: SkillDeleteRequest, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

/**
 * One plugin's catalogs, keyed by session.
 * The constructor captures the remote namespace; each session owns one snapshot.
 */
export class SkillCatalog {
  private readonly stores = new Map<SessionId, SnapshotStore<CatalogSnapshot>>()
  private readonly bodies = new Map<SessionId, Map<string, string>>()
  private readonly inflight = new Map<SessionId, AbortController>()

  /** @param skills - `ctx.remote.skills`. */
  constructor(private readonly skills: SkillsRemote) {}

  /**
   * The session's catalog source. The first read starts a list.
   * @param sessionId - session whose catalog to publish.
   * @returns the snapshot source the panel hook binds.
   */
  source(sessionId: SessionId): SnapshotStore<CatalogSnapshot> {
    const store = this.storeFor(sessionId)
    if (store.getSnapshot().status === 'idle') void this.reload(sessionId)
    return store
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
    const store = this.storeFor(sessionId)
    const current = store.getSnapshot()
    if (current.skills.length === 0) store.set({ status: 'loading', skills: [] })
    return this.fetch(sessionId, abort)
  }

  /**
   * Write one flat skill file.
   * @param sessionId - session whose project receives the file.
   * @param draft - form fields.
   * @returns a failure message, or undefined when the write was accepted.
   */
  async write(sessionId: SessionId, draft: SkillDraft): Promise<string | undefined> {
    const request: SkillWriteRequest = {
      sessionId,
      name: draft.name,
      description: draft.description,
      kind: draft.kind,
      subagent: draft.subagent,
      body: draft.body,
      ...draft.replaces === undefined ? {} : { replaces: draft.replaces },
    }
    const failed = await this.mutate(mutations => mutations.write(request))
    if (failed !== undefined) return failed
    const remembered = this.remember(sessionId, draft.name, draft.body)
    if (draft.replaces !== undefined && draft.replaces !== draft.name) remembered.delete(draft.replaces)
    await this.reload(sessionId)
    return undefined
  }

  /**
   * Delete one writable skill file.
   * @param sessionId - session whose project owns the file.
   * @param name - skill name.
   * @returns a failure message, or undefined when the delete was accepted.
   */
  async remove(sessionId: SessionId, name: string): Promise<string | undefined> {
    const failed = await this.mutate(mutations => mutations.delete({ sessionId, name }))
    if (failed !== undefined) return failed
    this.bodies.get(sessionId)?.delete(name)
    await this.reload(sessionId)
    return undefined
  }

  /** Abort every list still in flight. */
  dispose(): void {
    for (const abort of this.inflight.values()) abort.abort()
    this.inflight.clear()
  }

  private storeFor(sessionId: SessionId): SnapshotStore<CatalogSnapshot> {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const store = createSnapshotStore<CatalogSnapshot>(IDLE)
    this.stores.set(sessionId, store)
    return store
  }

  private remember(sessionId: SessionId, name: string, body: string): Map<string, string> {
    const map = this.bodies.get(sessionId) ?? new Map<string, string>()
    map.set(name, body)
    this.bodies.set(sessionId, map)
    return map
  }

  private overlay(sessionId: SessionId, skills: readonly ManagedSkill[]): ManagedSkill[] {
    const remembered = this.bodies.get(sessionId)
    return skills.map((skill) => {
      if (skill.body !== undefined) {
        this.remember(sessionId, skill.name, skill.body)
        return skill
      }
      const body = remembered?.get(skill.name)
      return body === undefined ? skill : { ...skill, body }
    })
  }

  private async fetch(sessionId: SessionId, abort: AbortController): Promise<void> {
    const store = this.storeFor(sessionId)
    try {
      const result = await this.skills.list({ sessionId }, abort.signal)
      if (abort.signal.aborted) return
      if (!result.ok) {
        store.set({ status: 'error', skills: store.getSnapshot().skills, message: result.error.message })
        return
      }
      store.set({ status: 'ready', skills: this.overlay(sessionId, result.value.skills.map(toManagedSkill)) })
    } catch (error) {
      if (abort.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      store.set({ status: 'error', skills: store.getSnapshot().skills, message })
    } finally {
      if (this.inflight.get(sessionId) === abort) this.inflight.delete(sessionId)
    }
  }

  private async mutate(
    run: (mutations: SkillMutations) => Promise<RemoteResult<unknown>>,
  ): Promise<string | undefined> {
    const carrier: object = this.skills
    if (!hasMutations(carrier)) return SKILL_MUTATIONS_UNAVAILABLE
    try {
      const result = await run(carrier)
      if (!result.ok) return result.error.message
      return undefined
    } catch (error) {
      // Assembly faults reject; a host refusal arrives as `ok: false` above.
      return error instanceof Error ? error.message : String(error)
    }
  }
}
