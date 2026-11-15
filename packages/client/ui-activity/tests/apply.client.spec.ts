// @vitest-environment jsdom
/** The plugin registers its copy, page type, body, and title, wires each Session's sources, and removes everything on unload. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import type { ActivityInjected } from '../src/client/ActivityPanel.tsx'
import { ActivityPanel } from '../src/client/ActivityPanel.tsx'
import { ActivityTitle } from '../src/client/ActivityTitle.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SpeedSample } from '../src/client/speed.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

interface Recorded {
  readonly name: string
  readonly key?: string
  readonly locale?: string
  readonly inject?: (sessionId: string) => ActivityInjected
  readonly component: unknown
}

it('registers the Activity page and releases every contribution on unload', async () => {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('sidebarRightTabs', tabs)
  const registered: Recorded[] = []
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    },
  } as never)
  const dictionaries = new Map<string, unknown>()
  ctx.provide('locale', {
    bind: () => (key: string) => `t:${key}`,
    register: (name: string, values: unknown) => { dictionaries.set(name, values); return () => { dictionaries.delete(name) } },
  } as never)
  const chatSource = { getSnapshot: () => undefined, subscribe: () => () => {} }
  const target = vi.fn(() => chatSource)
  const binding = vi.fn(() => ({ target }))
  ctx.provide('uiConversation', { binding } as never)
  const release = vi.fn()
  const jobsState = { getSnapshot: () => ({ rows: {}, observed: {} }), subscribe: () => () => {} }
  const watchRows = vi.fn(() => release)
  ctx.provide('jobs', { state: jobsState, watchRows } as never)

  const fiber = await ctx.plugin({ inject, apply }, { gitCommits: 5, speedSamples: 2, speedMinBucketSamples: 1, speedRecentRuns: 7 })
  const definition = tabs.get('activity')!
  expect(definition.id).toBe('@deepseek-ai/dsh-client-ui-activity')
  expect(definition.title('')).toBe('t:title')
  expect(definition.guide?.map(entry => [entry.id, entry.order, entry.title(), entry.description?.()])).toEqual([
    ['activity', 40, 't:title', 't:guide.description'],
  ])
  const Icon = definition.guide?.[0]?.icon
  if (Icon === undefined) throw new Error('Activity guide icon was not registered')
  expect(renderToStaticMarkup(createElement(Icon, { size: 22 }))).toContain('width="22"')
  expect(dictionaries.get('activity')).toEqual({ zh, en })
  expect(registered.map(entry => [entry.name, entry.key, entry.component])).toEqual([
    ['sidebar.right.pane.tab', '@deepseek-ai/dsh-client-ui-activity', ActivityPanel],
    ['sidebar.right.pane.tab.title', '@deepseek-ai/dsh-client-ui-activity', ActivityTitle],
  ])

  const face = registered[0]!.inject!('s1')
  expect(binding).toHaveBeenCalledWith('s1')
  expect(target).toHaveBeenCalledWith('chat')
  expect(face.hooks.chat).toBe(chatSource)
  expect(face.hooks.jobs).toBe(jobsState)
  expect(face.speedRecentRuns).toBe(7)
  expect(face.watchJobs()).toBe(release)
  expect(watchRows).toHaveBeenCalledWith('s1')

  // Recording reaches the shared history, its storage, and the provided service.
  const sample = (id: string, time: number, tokensPerSecond: number): SpeedSample => ({ id, time, model: 'm', ttftMs: 100, tokensPerSecond })
  face.recordSpeed([sample('1', 1, 10), sample('2', 2, 20), sample('3', 3, 30)])
  expect(face.hooks.speed.getSnapshot().map(entry => entry.id)).toEqual(['2', '3'])
  expect(JSON.parse(localStorage.getItem('dsh.activity.speed')!)).toHaveLength(2)
  expect(ctx.get('activitySpeed')!.expected('m', 3)).toMatchObject({ samples: 2, tokensPerSecond: 25 })

  // The repository read uses the configured commit count.
  const fetchStub = vi.fn(() => Promise.resolve(new Response('none', { status: 404 })))
  vi.stubGlobal('fetch', fetchStub)
  expect(await face.loadGit(new AbortController().signal)).toBeNull()
  expect(fetchStub.mock.calls[0]).toEqual(['api/activity.git?sessionId=s1&limit=5', expect.anything()])

  await fiber.dispose()
  expect(tabs.get('activity')).toBeUndefined()
  expect(registered).toEqual([])
  expect(dictionaries.size).toBe(0)
  expect(ctx.get('activitySpeed')).toBeUndefined()
  await ctx.fiber.dispose()
})

it('keeps the history in memory when browser storage is blocked and applies default bounds', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
  const ctx = new Context()
  ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(ctx))
  const registered: { inject?: (sessionId: string) => ActivityInjected }[] = []
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: { inject?: (sessionId: string) => ActivityInjected }) => { registered.push(options); return () => {} },
  } as never)
  ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  const source = { getSnapshot: () => undefined, subscribe: () => () => {} }
  ctx.provide('uiConversation', { binding: () => ({ target: () => source }) } as never)
  ctx.provide('jobs', { state: source, watchRows: () => () => {} } as never)
  await ctx.plugin({ inject, apply })
  Object.defineProperty(globalThis, 'localStorage', original)
  const face = registered[0]!.inject!('s1')
  expect(face.speedRecentRuns).toBe(30)
  face.recordSpeed([{ id: '1', time: 1, model: 'm', ttftMs: null, tokensPerSecond: 5 }])
  expect(face.hooks.speed.getSnapshot()).toHaveLength(1)
  await ctx.fiber.dispose()
})
