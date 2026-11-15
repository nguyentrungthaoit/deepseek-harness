/**
 * Lock state for one page: whether the screen is locked, whether a password is
 * set, and the transitions between them. The locked flag and the password
 * verifier persist in one localStorage record, so a reload or another tab of
 * the same origin stays locked; each tab follows the others through the
 * `storage` event.
 */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { hashPassword, verifyPassword, type PasswordRecord } from './password.ts'

/** localStorage key of the persisted lock record. */
export const LOCK_STORAGE_KEY = 'dsh.lock-screen'

/**
 * `unlocked`: the page is visible. `setup`: the overlay asks for a first
 * password, then locks. `change`: the overlay asks for a replacement password,
 * then uncovers the page. Neither step persists anything until it completes.
 * `locked`: the overlay covers the page until the password is entered.
 */
export type LockPhase = 'unlocked' | 'setup' | 'change' | 'locked'

/** Published lock state. */
export interface LockState {
  readonly phase: LockPhase
  readonly hasPassword: boolean
}

/** Persistence used by {@link LockController}; {@link browserLockStorage} is the page implementation. */
export interface LockStorage {
  /** @returns the raw persisted record, or null when none exists. */
  read(): string | null
  /** @param raw - serialized record to store. */
  write(raw: string): void
  /**
   * Observe writes made by other tabs.
   * @param listener - called after another tab changes the record.
   * @returns disposer removing the listener.
   */
  subscribe(listener: () => void): () => void
}

interface Persisted {
  readonly locked: boolean
  readonly password: PasswordRecord | undefined
}

/**
 * Parse a persisted record; anything malformed reads as unlocked without a password.
 * @param raw - stored text.
 * @returns the validated record.
 */
export function parseLockRecord(raw: string | null): Persisted {
  const empty: Persisted = { locked: false, password: undefined }
  if (raw === null) return empty
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    // A corrupt record is discarded; the next write replaces it.
    void error
    return empty
  }
  if (typeof value !== 'object' || value === null) return empty
  const record = value as { locked?: unknown; password?: unknown }
  const password = isPasswordRecord(record.password) ? record.password : undefined
  return { locked: record.locked === true && password !== undefined, password }
}

function isPasswordRecord(value: unknown): value is PasswordRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.salt === 'string' && /^[0-9a-f]+$/u.test(record.salt)
    && typeof record.digest === 'string' && /^[0-9a-f]{64}$/u.test(record.digest)
    && typeof record.iterations === 'number' && Number.isInteger(record.iterations) && record.iterations > 0
}

/** Lock transitions over one {@link LockStorage}. */
export class LockController {
  private readonly store
  private readonly dispose: () => void
  /** Current lock state for overlay, button, and Settings row. */
  readonly state: ObservableSnapshot<LockState>

  /**
   * @param storage - persisted lock record.
   * @param iterations - PBKDF2 iteration count for new passwords.
   */
  constructor(private readonly storage: LockStorage, private readonly iterations: number) {
    this.store = createSnapshotStore<LockState>(this.fromStorage(undefined), { flush: 'sync' })
    this.state = this.store
    this.dispose = storage.subscribe(() => { this.store.set(this.fromStorage(this.store.getSnapshot().phase)) })
  }

  /** Cover the page; without a password, ask for one first. */
  lock(): void {
    const persisted = parseLockRecord(this.storage.read())
    if (persisted.password === undefined) {
      this.store.set({ phase: 'setup', hasPassword: false })
      return
    }
    this.persist({ locked: true, password: persisted.password })
  }

  /** Ask for a new password over the page; completing it leaves the page uncovered. */
  changePassword(): void {
    if (this.store.getSnapshot().phase !== 'unlocked') return
    this.store.set({ phase: 'change', hasPassword: this.store.getSnapshot().hasPassword })
  }

  /** Leave the first-password or change-password step without storing anything. */
  cancelSetup(): void {
    const phase = this.store.getSnapshot().phase
    if (phase === 'setup' || phase === 'change') this.store.set(this.fromStorage(undefined))
  }

  /**
   * Store a password: a first password locks the page, a changed one leaves it uncovered.
   * @param password - new password text.
   */
  async setPassword(password: string): Promise<void> {
    const locked = this.store.getSnapshot().phase !== 'change'
    this.persist({ locked, password: await hashPassword(password, this.iterations) })
  }

  /**
   * Check a candidate against the stored password without unlocking.
   * @param password - candidate text.
   * @returns whether it matches.
   */
  async check(password: string): Promise<boolean> {
    const record = parseLockRecord(this.storage.read()).password
    return record !== undefined && verifyPassword(password, record)
  }

  /** Uncover the page after a successful {@link check}. */
  release(): void {
    this.persist({ locked: false, password: parseLockRecord(this.storage.read()).password })
  }

  /** Forget the password; the next lock asks for a new one. */
  removePassword(): void {
    this.persist({ locked: false, password: undefined })
  }

  /** Stop following other tabs. */
  close(): void {
    this.dispose()
  }

  private persist(next: Persisted): void {
    this.storage.write(JSON.stringify(next))
    this.store.set(this.fromStorage(undefined))
  }

  private fromStorage(previous: LockPhase | undefined): LockState {
    const persisted = parseLockRecord(this.storage.read())
    const hasPassword = persisted.password !== undefined
    if (persisted.locked) return { phase: 'locked', hasPassword }
    if (previous === 'change' || (previous === 'setup' && !hasPassword)) return { phase: previous, hasPassword }
    return { phase: 'unlocked', hasPassword }
  }
}

/**
 * localStorage persistence that follows writes from other tabs.
 * @param window - page window.
 * @param key - localStorage key of the record.
 * @returns the storage adapter.
 */
export function browserLockStorage(window: Window, key: string): LockStorage {
  return {
    read: () => window.localStorage.getItem(key),
    write: (raw) => { window.localStorage.setItem(key, raw) },
    subscribe: (listener) => {
      const onStorage = (event: StorageEvent): void => {
        if (event.key === key || event.key === null) listener()
      }
      window.addEventListener('storage', onStorage)
      return () => { window.removeEventListener('storage', onStorage) }
    },
  }
}
