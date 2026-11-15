// @vitest-environment jsdom
/** Lock transitions, persistence parsing, and cross-tab following. */
import { describe, expect, it } from 'vitest'
import { browserLockStorage, LOCK_STORAGE_KEY, LockController, parseLockRecord, type LockStorage } from '../src/client/lock-store.ts'
import { hashPassword, verifyPassword } from '../src/client/password.ts'

function memoryStorage(initial: string | null = null): LockStorage & { raw: string | null; external(raw: string | null): void } {
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

describe('LockController', () => {
  it('asks for a first password, then locks and unlocks with it', async () => {
    const storage = memoryStorage()
    const controller = new LockController(storage, 2)
    expect(controller.state.getSnapshot()).toEqual({ phase: 'unlocked', hasPassword: false })
    controller.lock()
    expect(controller.state.getSnapshot()).toEqual({ phase: 'setup', hasPassword: false })
    await controller.setPassword('hunter2')
    expect(controller.state.getSnapshot()).toEqual({ phase: 'locked', hasPassword: true })
    expect(await controller.check('wrong')).toBe(false)
    expect(controller.state.getSnapshot().phase).toBe('locked')
    expect(await controller.check('hunter2')).toBe(true)
    controller.release()
    expect(controller.state.getSnapshot()).toEqual({ phase: 'unlocked', hasPassword: true })
    controller.lock()
    expect(controller.state.getSnapshot().phase).toBe('locked')
  })

  it('changes the password without locking and cancels a change', async () => {
    const storage = memoryStorage()
    const controller = new LockController(storage, 2)
    controller.changePassword()
    expect(controller.state.getSnapshot()).toEqual({ phase: 'change', hasPassword: false })
    await controller.setPassword('first')
    expect(controller.state.getSnapshot()).toEqual({ phase: 'unlocked', hasPassword: true })
    controller.changePassword()
    storage.external(storage.raw)
    expect(controller.state.getSnapshot().phase).toBe('change')
    controller.cancelSetup()
    expect(controller.state.getSnapshot().phase).toBe('unlocked')
    controller.changePassword()
    await controller.setPassword('second')
    expect(await controller.check('first')).toBe(false)
    expect(await controller.check('second')).toBe(true)
    controller.lock()
    controller.changePassword()
    expect(controller.state.getSnapshot().phase).toBe('locked')
  })

  it('cancels the first-password step without persisting', () => {
    const storage = memoryStorage()
    const controller = new LockController(storage, 2)
    controller.cancelSetup()
    controller.lock()
    controller.cancelSetup()
    expect(controller.state.getSnapshot().phase).toBe('unlocked')
    expect(storage.raw).toBeNull()
  })

  it('restores a locked page from storage and forgets a removed password', async () => {
    const record = await hashPassword('pw', 2)
    const storage = memoryStorage(JSON.stringify({ locked: true, password: record }))
    const controller = new LockController(storage, 2)
    expect(controller.state.getSnapshot()).toEqual({ phase: 'locked', hasPassword: true })
    controller.removePassword()
    expect(controller.state.getSnapshot()).toEqual({ phase: 'unlocked', hasPassword: false })
    expect(await controller.check('pw')).toBe(false)
  })

  it('follows other tabs and keeps a pending setup until one locks', async () => {
    const record = await hashPassword('pw', 2)
    const storage = memoryStorage()
    const controller = new LockController(storage, 2)
    controller.lock()
    storage.external(null)
    expect(controller.state.getSnapshot().phase).toBe('setup')
    storage.external(JSON.stringify({ locked: true, password: record }))
    expect(controller.state.getSnapshot().phase).toBe('locked')
    storage.external(JSON.stringify({ locked: false, password: record }))
    expect(controller.state.getSnapshot().phase).toBe('unlocked')
    controller.close()
    storage.external(JSON.stringify({ locked: true, password: record }))
    expect(controller.state.getSnapshot().phase).toBe('unlocked')
  })
})

describe('parseLockRecord', () => {
  const password = { salt: 'ab', iterations: 2, digest: 'a'.repeat(64) }
  it.each([
    ['null', null],
    ['invalid JSON', '{'],
    ['a scalar', '1'],
    ['null JSON', 'null'],
    ['a locked flag without password', JSON.stringify({ locked: true })],
    ['a malformed password', JSON.stringify({ locked: true, password: { salt: 'zz', iterations: 2, digest: 'x' } })],
    ['a non-object password', JSON.stringify({ locked: true, password: 'x' })],
    ['a bad iteration count', JSON.stringify({ locked: true, password: { ...password, iterations: 0 } })],
  ])('reads %s as unlocked', (_name, raw) => {
    expect(parseLockRecord(raw).locked).toBe(false)
  })

  it('reads a valid record', () => {
    expect(parseLockRecord(JSON.stringify({ locked: true, password }))).toEqual({ locked: true, password })
  })
})

describe('browserLockStorage', () => {
  it('reads, writes, and follows storage events for its key', () => {
    window.localStorage.clear()
    const storage = browserLockStorage(window, LOCK_STORAGE_KEY)
    expect(storage.read()).toBeNull()
    storage.write('x')
    expect(window.localStorage.getItem(LOCK_STORAGE_KEY)).toBe('x')
    let calls = 0
    const dispose = storage.subscribe(() => { calls++ })
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK_STORAGE_KEY }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    dispose()
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK_STORAGE_KEY }))
    expect(calls).toBe(2)
  })
})

describe('password records', () => {
  it('verifies the original password only', async () => {
    const record = await hashPassword('secret', 3)
    expect(record.iterations).toBe(3)
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(await verifyPassword('secret', record)).toBe(true)
    expect(await verifyPassword('Secret', record)).toBe(false)
    expect((await hashPassword('secret', 3)).salt).not.toBe(record.salt)
  })
})
