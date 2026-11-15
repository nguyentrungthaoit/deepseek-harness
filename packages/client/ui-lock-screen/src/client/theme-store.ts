/**
 * Lock screen style for one browser: the pixel developer room or the Matrix
 * code rain. The choice persists in its own localStorage record, apart from
 * the password, and every tab of the origin follows it.
 */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LockStorage } from './lock-store.ts'

/** localStorage key of the persisted style. */
export const LOCK_THEME_STORAGE_KEY = 'dsh.lock-screen.theme'

/** Lock screen styles, in Settings order. */
export const LOCK_THEMES = ['pixel', 'matrix'] as const

/** One lock screen style. */
export type LockTheme = typeof LOCK_THEMES[number]

/**
 * Parse a persisted style; anything unknown reads as the pixel room.
 * @param raw - stored text.
 * @returns the style.
 */
export function parseLockTheme(raw: string | null): LockTheme {
  return raw === 'matrix' ? 'matrix' : 'pixel'
}

/** The chosen style over one {@link LockStorage}. */
export class LockThemeController {
  private readonly store
  private readonly dispose: () => void
  /** Current style for the overlay and Settings row. */
  readonly state: ObservableSnapshot<LockTheme>

  /** @param storage - persisted style record. */
  constructor(private readonly storage: LockStorage) {
    this.store = createSnapshotStore<LockTheme>(parseLockTheme(storage.read()), { flush: 'sync' })
    this.state = this.store
    this.dispose = storage.subscribe(() => { this.store.set(parseLockTheme(this.storage.read())) })
  }

  /** @param theme - style to show from the next frame on. */
  set(theme: LockTheme): void {
    this.storage.write(theme)
    this.store.set(theme)
  }

  /** Stop following other tabs. */
  close(): void {
    this.dispose()
  }
}
