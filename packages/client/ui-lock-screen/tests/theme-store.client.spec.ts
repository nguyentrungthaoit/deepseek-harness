/** Lock screen style parsing, persistence, and cross-tab following. */
import { describe, expect, it } from 'vitest'
import type { LockStorage } from '../src/client/lock-store.ts'
import { LockThemeController, parseLockTheme } from '../src/client/theme-store.ts'

function memoryStorage(initial: string | null): LockStorage & { raw: string | null; external(raw: string | null): void } {
  const listeners = new Set<() => void>()
  const storage = {
    raw: initial,
    read: () => storage.raw,
    write: (raw: string) => { storage.raw = raw },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    external: (raw: string | null) => { storage.raw = raw; for (const listener of listeners) listener() },
  }
  return storage
}

describe('parseLockTheme', () => {
  it.each([[null, 'pixel'], ['pixel', 'pixel'], ['matrix', 'matrix'], ['neon', 'pixel']] as const)('reads %s as %s', (raw, theme) => {
    expect(parseLockTheme(raw)).toBe(theme)
  })
})

describe('LockThemeController', () => {
  it('stores the chosen style and follows other tabs until closed', () => {
    const storage = memoryStorage('matrix')
    const controller = new LockThemeController(storage)
    expect(controller.state.getSnapshot()).toBe('matrix')
    controller.set('pixel')
    expect(storage.raw).toBe('pixel')
    expect(controller.state.getSnapshot()).toBe('pixel')
    storage.external('matrix')
    expect(controller.state.getSnapshot()).toBe('matrix')
    controller.close()
    storage.external('pixel')
    expect(controller.state.getSnapshot()).toBe('matrix')
  })
})
