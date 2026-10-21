/**
 * The plugin's registrations, composer insert, catalog refresh, per-session views, and the overlay toast.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { SKILLS_ID, SKILLS_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { SkillManagerBody } from '../src/client/Panel.tsx'
import { SkillManagerToast } from '../src/client/SkillToast.tsx'
import { SkillManagerTitle } from '../src/client/Title.tsx'

interface Recorded {
  name: string
  key?: string
  id?: string
  locale?: string
  inject?: (sessionId: string) => {
    useInChat: (name: string) => void
    write: (draft: {
      name: string
      description: string
      subagent: boolean
      body: string
    }) => Promise<{ message: string; conflict: boolean } | undefined>
    remove: (name: string, expectedVersion?: string) => Promise<{ message: string; conflict: boolean } | undefined>
    reload: () => void
    navigate: (view: { kind: 'list' } | { kind: 'create' }) => void
    notify: (toast: { kind: 'saved'; name: string }) => void
    dismiss: () => void
    hooks: {
      catalog: { getSnapshot: () => { status: string } }
      view: { getSnapshot: () => { kind: string } }
      toast: { getSnapshot: () => { kind: string; name: string } | null }
    }
  }
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const sessionCtx = new Context()
  const texts: string[] = []
  sessionCtx.on('conversation/input-append-text', (request: { text: string }) => {
    texts.push(request.text)
    return true
  })
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
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const list = vi.fn(async () => ({ ok: true as const, value: { skills: [] } }))
  const write = vi.fn(async () => ({ ok: true as const, value: { path: '/p' } }))
  const del = vi.fn(async () => ({ ok: true as const, value: { path: '/p' } }))
  const remote = new TestRemote(ctx, { skills: { list, write, delete: del } })
  const bound = new Set(['s1'])
  const sessions = {
    binding: (sessionId: string) => bound.has(sessionId) ? { ctx: sessionCtx } : undefined,
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, remote, list, write, del, texts, bound }
}

describe('ui-skill-manager apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.skills', 'sessions'])
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    try {
      const definition = tabs.get(SKILLS_KIND)
      expect(definition?.id).toBe(SKILLS_ID)
      expect(definition?.priority).toBe('builtin')
      expect(definition?.title('sidebar://skills')).toBe('type.label')
      expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
        .toEqual([[15, 'guide.title', 'guide.description']])
      expect(dictionaries.get('skillManager')).toEqual({ zh, en })
      expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.locale, entry.component])).toEqual([
        ['sidebar.right.pane.tab', SKILLS_ID, 'skillManager', SkillManagerBody],
        ['shell.overlay', 'skill-manager.toast', 'skillManager', SkillManagerToast],
        ['sidebar.right.pane.tab.title', SKILLS_ID, undefined, SkillManagerTitle],
      ])
    } finally { await fiber.dispose() }
  })

  it('appends /name to the session composer and refetches when skills/change fires', async () => {
    const { registered, fiber, remote, list, write, del, texts } = await boot()
    try {
      const face = registered[0]?.inject?.('s1')
      expect(face).toBeDefined()
      face!.useInChat('field-list')
      expect(texts).toEqual(['/field-list '])
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(1) })
      registered[0]?.inject?.('missing')?.useInChat('field-list')
      expect(texts).toEqual(['/field-list '])
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
      remote.emit('skills/change', [])
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(4) })
      const draft = { name: 'field-list', description: 'List.', subagent: false, body: '' }
      expect(await face!.write(draft)).toBeUndefined()
      expect(write).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', name: 'field-list' }))
      expect(await face!.remove('field-list')).toBeUndefined()
      expect(del).toHaveBeenCalledWith({ sessionId: 's1', name: 'field-list' })
      face!.reload()
    } finally { await fiber.dispose() }
  })

  it('keeps a view per session and reports toasts through the overlay entry', async () => {
    const { registered, fiber, list } = await boot()
    try {
      const body = registered.find(entry => entry.name === 'sidebar.right.pane.tab')!
      const overlay = registered.find(entry => entry.name === 'shell.overlay')!
      const face = body.inject!('s1')
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(1) })
      face.navigate({ kind: 'create' })
      expect(body.inject!('s1').hooks.view.getSnapshot()).toEqual({ kind: 'create' })
      expect(body.inject!('s2').hooks.view.getSnapshot()).toEqual({ kind: 'list' })
      const toast = overlay.inject!('')
      face.notify({ kind: 'saved', name: 'field-list' })
      expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'saved', name: 'field-list' })
      toast.dismiss()
      expect(toast.hooks.toast.getSnapshot()).toBeNull()
    } finally { await fiber.dispose() }
  })

  it('forgets a session whose binding is gone the next time a catalog is requested', async () => {
    const { registered, fiber, list, bound } = await boot()
    try {
      const first = registered[0]?.inject?.('s1')
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(1) })
      bound.delete('s1')
      registered[0]?.inject?.('s2')
      await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
      const again = registered[0]?.inject?.('s1')
      expect(again?.hooks.catalog).not.toBe(first?.hooks.catalog)
    } finally { await fiber.dispose() }
  })
})
