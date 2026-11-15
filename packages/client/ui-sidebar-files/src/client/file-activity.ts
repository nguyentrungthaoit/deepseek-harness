/**
 * What the agent has done to files, derived from the session's tool calls.
 *
 * Client-only and model-free: the source is the `tool/call` arguments of the
 * first-party file tools, kept only once the matching `tool/result` settles
 * without an error. Nothing here is logged or sent anywhere; the tree reads it
 * to tint rows, and every record expires on its own after the configured fade.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionEventSource, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/** How the agent touched a file; later members outrank earlier ones when a file is touched more than once. */
export type FileActivityKind = 'read' | 'edit' | 'create'

/** Order in which kinds outrank one another. */
const RANK: Record<FileActivityKind, number> = { read: 0, edit: 1, create: 2 }

/** One file's recent activity. */
export interface FileHeat {
  /** The strongest thing done to the file inside the fade window. */
  readonly kind: FileActivityKind
  /** Reads inside the fade window. */
  readonly reads: number
  /** Edits and overwrites inside the fade window, creation excluded. */
  readonly edits: number
  /** Epoch milliseconds of the most recent touch. */
  readonly at: number
}

/** Every file with activity inside the fade window, keyed by the path the tool was given. */
export interface FileActivitySnapshot {
  readonly files: ReadonlyMap<string, FileHeat>
}

/** The tool call a settled result belongs to. */
interface PendingCall {
  readonly path: string
  readonly kind: FileActivityKind
  /** A `write` becomes a creation when its result says so. */
  readonly writes: boolean
}

/**
 * The file a first-party tool call touches.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the path and what the call does to it, or null for any other call or malformed arguments.
 */
export function activityOf(name: string, argsRaw: string): PendingCall | null {
  let args: unknown
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    args = parsed
  } catch {
    return null
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  const record = args as Record<string, unknown>
  const text = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null
  const filePath = text(record.file_path)
  switch (name) {
    case 'read':
    case 'read_image':
    case 'read_document':
      return filePath === null ? null : { path: filePath, kind: 'read', writes: false }
    case 'write':
      return filePath === null ? null : { path: filePath, kind: 'edit', writes: true }
    case 'edit':
      return filePath === null ? null : { path: filePath, kind: 'edit', writes: false }
    case 'str_replace_editor': {
      const path = text(record.path)
      if (path === null) return null
      if (record.command === 'view') return { path, kind: 'read', writes: false }
      if (record.command === 'create') return { path, kind: 'create', writes: false }
      return { path, kind: 'edit', writes: false }
    }
    default:
      return null
  }
}

/**
 * The absolute, separator-normalised spelling of a path, so a tool's spelling and the tree's agree.
 * @param path - the path as a tool or the tree spells it.
 * @param root - the workspace root relative paths are resolved against.
 * @returns forward-slash path with `.`/`..` folded, a lowercase drive letter, and no trailing slash.
 */
export function canonicalPath(path: string, root: string): string {
  const slashed = path.replace(/\\/g, '/')
  const absolute = /^(\/|[A-Za-z]:\/)/.test(slashed)
  const joined = absolute ? slashed : `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${slashed}`
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? ''
  const parts: string[] = []
  for (const part of joined.slice(drive.length).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `${drive.toLowerCase()}/${parts.join('/')}`
}

/**
 * How warm a record still is.
 * @param heat - the record.
 * @param now - epoch milliseconds.
 * @param fadeMs - how long a touch stays visible.
 * @returns 1 at the moment of the touch, falling linearly to 0 when the fade is over.
 */
export function intensityOf(heat: FileHeat, now: number, fadeMs: number): number {
  return Math.min(1, Math.max(0, 1 - (now - heat.at) / fadeMs))
}

/** Subscribable, pull-based derivation of {@link FileActivitySnapshot} over one session's event window. */
export class FileActivityTracker implements ObservableSnapshot<FileActivitySnapshot> {
  private revision = -1
  private files = new Map<string, FileHeat>()
  private pending = new Map<string, PendingCall>()
  private snapshot: FileActivitySnapshot = { files: this.files }

  /**
   * @param source - the session's contiguous event window.
   * @param fadeMs - how long a touch stays visible; older events are never recorded.
   * @param now - epoch-millisecond clock.
   */
  constructor(
    private readonly source: SessionEventSource,
    private readonly fadeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** @returns the activity as of the latest event window; the same object until a record changes. */
  readonly getSnapshot = (): FileActivitySnapshot => {
    const window = this.source.getSnapshot()
    if (window.revision === this.revision) return this.snapshot
    const { change } = window
    if (window.revision === this.revision + 1 && change.kind !== 'replace') {
      if (change.kind === 'append') this.ingest(change.entries)
    } else {
      // A replaced window, or one that moved while nobody listened, is read whole.
      this.files = new Map()
      this.pending = new Map()
      this.snapshot = { files: this.files }
      this.ingest(window.entries)
    }
    this.revision = window.revision
    return this.snapshot
  }

  /**
   * Hear about every event-window change.
   * @param listener - invalidation callback; it re-reads {@link getSnapshot}.
   * @returns unsubscribe function.
   */
  readonly subscribe = (listener: () => void): (() => void) => this.source.subscribe(listener)

  private ingest(entries: readonly SessionEventLikeEntry[]): void {
    const horizon = this.now() - this.fadeMs
    let changed = false
    for (const entry of entries) {
      if (entry.type !== 'event') continue
      const { event } = entry
      if (event.type === 'tool/call') {
        const call = activityOf(event.data.name, event.data.arguments)
        if (call !== null) this.pending.set(String(event.data.callId), call)
        continue
      }
      if (event.type !== 'tool/result') continue
      const callId = String(event.data.message.source.callId)
      const call = this.pending.get(callId)
      this.pending.delete(callId)
      if (call === undefined || event.data.message.isError === true || event.time < horizon) continue
      const meta = event.data.meta as { operation?: unknown } | null | undefined
      const kind = call.writes && meta?.operation === 'create' ? 'create' : call.kind
      this.record(call.path, kind, event.time, horizon)
      changed = true
    }
    if (changed) this.snapshot = { files: this.files }
  }

  private record(path: string, kind: FileActivityKind, at: number, horizon: number): void {
    const live = new Map([...this.files].filter(([, heat]) => heat.at >= horizon))
    const before = live.get(path)
    const reads = (before?.reads ?? 0) + (kind === 'read' ? 1 : 0)
    const edits = (before?.edits ?? 0) + (kind === 'edit' ? 1 : 0)
    const strongest = before !== undefined && RANK[before.kind] > RANK[kind] ? before.kind : kind
    this.files = live.set(path, { kind: strongest, reads, edits, at: Math.max(at, before?.at ?? 0) })
  }
}
