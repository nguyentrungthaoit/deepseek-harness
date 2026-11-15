/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and Remote faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's id with its store
 * and face — and that every registration is gone after dispose, which is what
 * makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { FILES_ID, FILES_KIND } from '../src/client/definition.tsx'
import { apply, Config, inject } from '../src/client/index.ts'
import type { FilesInjected } from '../src/client/face.ts'
import { apply as hostApply } from '../src/index.ts'
import { FilesBody } from '../src/client/FilesBody.tsx'
import { FilesTitle } from '../src/client/FilesTitle.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  store: unknown
  inject: unknown
  component: unknown
}

async function boot(config?: Parameters<typeof apply>[1]) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const workspaceFiles = { list: vi.fn() }
  const sidebar = { commandTarget: vi.fn(), openTabFromTarget: vi.fn() }
  const commands: ShortcutCommand[] = []
  ctx.provide('shortcuts', { register: (command: ShortcutCommand) => {
    commands.push(command)
    return () => { commands.splice(commands.indexOf(command), 1) }
  } } as never)
  ctx.provide('sidebarRight', sidebar as never)
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { workspaceFiles } as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  const bindings = new Map<string, { eventSource: MutableSessionEventSource }>([['known', { eventSource: new MutableSessionEventSource() }]])
  ctx.provide('sessions', { binding: (id: string) => bindings.get(id) } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply }, config === undefined ? undefined : Config(config))
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, sidebar, commands, bindings }
}

describe('ui-sidebar-files apply', () => {
  it('opens files for the command target and refuses without a selected Session', async () => {
    const h = await boot()
    try {
      const command = h.commands[0]!
      const input = { region: 'page', modal: null, target: null } as const
      expect(command.label()).toBe('guide.title')
      expect(command.resolve(input)).toEqual({ status: 'blocked', reason: 'shortcut.noSession' })
      const target = { sessionId: 'files-session' }
      h.sidebar.commandTarget.mockReturnValue(target)
      const result = command.resolve(input)
      if (result.status !== 'handled') throw new Error('Expected files command to be available')
      result.run()
      expect(h.sidebar.openTabFromTarget).toHaveBeenCalledWith('files', target)
    } finally { await h.fiber.dispose() }
    expect(h.commands).toEqual([])
  })
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(FILES_KIND)
    expect(definition?.id).toBe(FILES_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('sidebar://files')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[10, 'guide.title', 'guide.description']])
    expect(dictionaries.get('sidebarFiles')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', FILES_ID, 'sidebarFiles', FilesBody],
      ['sidebar.right.pane.tab.title', FILES_ID, undefined, FilesTitle],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('hands each tree one activity source per session, quiet for a session that is not materialized', async () => {
    const h = await boot()
    const face = (registered: unknown, id: string) => (registered as (id: string, actions: never) => FilesInjected)(id, {} as never)
    const inject = h.registered[0]!.inject
    const known = face(inject, 'known').hooks.fileActivity
    expect(face(inject, 'known').hooks.fileActivity).toBe(known)
    expect(known.getSnapshot().files.size).toBe(0)
    const absent = face(inject, 'absent').hooks.fileActivity
    expect(absent.getSnapshot()).toBe(absent.getSnapshot())
    const stop = absent.subscribe(() => {})
    stop()
  })

  it.each([[{}, 180_000, true], [{ heatFadeSeconds: 20, heatmap: false }, 20_000, false]])('takes the fade and the starting state from config %j', async (config, fadeMs, enabled) => {
    const h = await boot(config)
    const actions = { start: vi.fn(), heatmap: vi.fn(), forget: vi.fn() }
    const face = (h.registered[0]!.inject as (id: string, actions: never) => FilesInjected)('known', actions as never)
    expect(face.heatFadeMs).toBe(fadeMs)
    const stop = new AbortController()
    face.start('t' as never, '/root', stop.signal)
    expect(actions.heatmap).toHaveBeenCalledTimes(enabled ? 0 : 1)
    stop.abort()
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(FILES_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
