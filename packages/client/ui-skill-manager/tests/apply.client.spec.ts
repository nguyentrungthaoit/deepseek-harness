/**
 * The plugin's registrations, composer insert, and catalog refresh.
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
import { SkillManagerTitle } from '../src/client/Title.tsx'

interface Recorded {
  name: string
  key: string
  locale?: string
  inject?: (sessionId: string) => {
    useInChat: (name: string) => void
    write: (draft: {
      name: string
      description: string
      kind: 'rule' | 'skill'
      subagent: boolean
      body: string
    }) => Promise<string | undefined>
    remove: (name: string) => Promise<string | undefined>
    reload: () => void
    hooks: { catalog: { getSnapshot: () => { status: string } } }
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
  const remote = new TestRemote(ctx, { skills: { list } })
  const sessions = {
    binding: (sessionId: string) => sessionId === 's1' ? { ctx: sessionCtx } : undefined,
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, remote, list, texts }
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
      expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
        ['sidebar.right.pane.tab', SKILLS_ID, 'skillManager', SkillManagerBody],
        ['sidebar.right.pane.tab.title', SKILLS_ID, undefined, SkillManagerTitle],
      ])
    } finally { await fiber.dispose() }
  })

  it('appends /name to the session composer and refetches when skills/change fires', async () => {
    const { registered, fiber, remote, list, texts } = await boot()
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
      const draft = { name: 'field-list', description: 'List.', kind: 'skill' as const, subagent: false, body: '' }
      expect(await face!.write(draft)).toBe('unavailable')
      expect(await face!.remove('field-list')).toBe('unavailable')
      face!.reload()
    } finally { await fiber.dispose() }
  })
})
