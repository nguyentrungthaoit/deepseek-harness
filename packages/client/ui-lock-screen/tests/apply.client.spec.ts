// @vitest-environment jsdom
/** Plugin apply: dictionaries, slot registrations, and the shortcut. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindingIssue, isWebBindingAllowed, normalizeBinding, type ShortcutBinding, type ShortcutPlatform, type ShortcutRuntime } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { apply, inject, LOCK_COMMAND_ID, NS } from '../src/client/index.ts'
import { LockButton } from '../src/client/LockButton.tsx'
import { LockOverlay } from '../src/client/LockOverlay.tsx'
import { LockSettingsRow } from '../src/client/LockSettingsRow.tsx'
import { LOCK_STORAGE_KEY } from '../src/client/lock-store.ts'
import { LOCK_THEME_STORAGE_KEY } from '../src/client/theme-store.ts'

interface Registered {
  options: { name: string; id?: string; order?: number; locale?: string; inject?: () => Record<string, unknown> }
  component: unknown
}
interface Command {
  id: string
  defaults: Record<string, ShortcutBinding>
  label(): string
  resolve(context: { modal: string | null }): { status: string; run?: () => void }
}

async function boot() {
  const ctx = new Context()
  const registered: Registered[] = []
  const commands: Command[] = []
  const disposed: string[] = []
  ctx.provide('slots', {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Registered['options'], component: unknown) => {
      registered.push({ options, component })
      return () => { disposed.push(options.name) }
    }),
  } as never)
  ctx.provide('locale', {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn(() => () => {}),
  } as never)
  ctx.provide('shortcuts', {
    register: vi.fn((command: Command) => { commands.push(command); return () => { disposed.push(command.id) } }),
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = (name: string): Registered => registered.find(item => item.options.name === name)!
  return { ctx, fiber, registered, commands, disposed, entry }
}

describe('apply', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('registers the overlay, the sidebar button, and the Settings row', async () => {
    const { entry } = await boot()
    expect(entry('shell.overlay')).toMatchObject({ component: LockOverlay, options: { id: 'lock-screen', locale: NS } })
    expect(entry('sidebar.footer.action')).toMatchObject({ component: LockButton, options: { id: 'lock-screen' } })
    expect(entry('settings.general.item')).toMatchObject({ component: LockSettingsRow, options: { order: 14 } })
  })

  it('drives one shared lock state through every surface', async () => {
    const { entry, commands } = await boot()
    const overlay = entry('shell.overlay').options.inject!() as {
      hooks: { lock: { getSnapshot(): { phase: string } } }
      check(password: string): Promise<boolean>
      release(): void
      setPassword(password: string): Promise<void>
      cancelSetup(): void
    }
    const button = entry('sidebar.footer.action').options.inject!() as { lock(): void }
    const row = entry('settings.general.item').options.inject!() as { lock(): void; changePassword(): void; removePassword(): void }
    button.lock()
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('setup')
    overlay.cancelSetup()
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('unlocked')
    row.lock()
    await overlay.setPassword('pw')
    expect(window.localStorage.getItem(LOCK_STORAGE_KEY)).toContain('"locked":true')
    expect(await overlay.check('pw')).toBe(true)
    overlay.release()
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('unlocked')
    const command = commands.find(item => item.id === LOCK_COMMAND_ID)!
    expect(command.label()).toBe('shortcut.lock')
    expect(command.resolve({ modal: 'settings' })).toEqual({ status: 'blocked', reason: 'modal' })
    command.resolve({ modal: null }).run!()
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('locked')
    overlay.release()
    row.changePassword()
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('change')
    overlay.cancelSetup()
    row.removePassword()
    expect(overlay.hooks.lock.getSnapshot()).toEqual({ phase: 'unlocked', hasPassword: false })
    const style = entry('settings.general.item').options.inject!() as { setTheme(theme: string): void; hooks: { theme: { getSnapshot(): string } } }
    expect(style.hooks.theme.getSnapshot()).toBe('pixel')
    style.setTheme('matrix')
    expect(style.hooks.theme.getSnapshot()).toBe('matrix')
    expect(window.localStorage.getItem(LOCK_THEME_STORAGE_KEY)).toBe('matrix')
    const request = vi.fn(async () => {})
    document.documentElement.requestFullscreen = request
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    button.lock()
    expect(request).toHaveBeenCalledTimes(1)
    expect(overlay.hooks.lock.getSnapshot().phase).toBe('setup')
  })

  it('declares only shortcut defaults the shortcut service accepts', async () => {
    const { commands } = await boot()
    const command = commands.find(item => item.id === LOCK_COMMAND_ID)!
    for (const [profile, binding] of Object.entries(command.defaults)) {
      const [runtime, platform] = profile.split(':') as [ShortcutRuntime, ShortcutPlatform]
      const normalized = normalizeBinding(binding, platform)
      expect(bindingIssue(normalized, runtime, platform), profile).toBeNull()
      if (runtime === 'web') expect(isWebBindingAllowed(normalized, platform), profile).toBe(true)
    }
    expect(Object.keys(command.defaults)).not.toContain('web:linux')
  })

  it('releases the shortcut on dispose', async () => {
    const { fiber, disposed } = await boot()
    await fiber.dispose()
    expect(disposed).toEqual([LOCK_COMMAND_ID])
  })
})
