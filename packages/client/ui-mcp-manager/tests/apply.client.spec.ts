/** Plugin apply: registrations, locale, and the change-driven refresh. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { McpPanel, type McpPanelFace } from '../src/client/McpPanel.tsx'
import { McpPanelIcon } from '../src/client/McpPanelIcon.tsx'
import type { createNavigationStore } from '../src/client/navigation-store.ts'

type NavHandle = ReturnType<typeof createNavigationStore>

interface Recorded {
  options: {
    name: string
    key?: string
    id?: string
    order?: number
    locale?: string
    label?: () => string
    store?: NavHandle
    inject?: () => McpPanelFace
  }
  component: unknown
}

const ok = { ok: true as const, value: { application: 'applied', warnings: [] } }

async function boot(options: { withManager?: boolean; active?: string | null } = {}) {
  const ctx = new Context()
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => Iterable<unknown> | (() => void)) => {
      const result = register()
      // The generator form yields the registrations to drain; the plain form returns one.
      if (typeof result !== 'function') for (const _item of result) { /* drain */ }
    }),
    register: vi.fn((opts: Recorded['options'], component: unknown) => {
      registered.push({ options: opts, component })
      return () => {}
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
  const mcp = {
    list: vi.fn(async () => ({ ok: true as const, value: { servers: [] } })),
    create: vi.fn(async () => ok),
    update: vi.fn(async () => ok),
    removeServer: vi.fn(async () => ok),
    reconnect: vi.fn(async () => ok),
  }
  const panelInfo = createSnapshotStore<{ activePanelId: string | null }>({ activePanelId: options.active ?? null })
  const remote = new TestRemote(ctx, {
    mcp,
    ...options.withManager === false ? {} : { pluginManager: { setPluginEnabled: vi.fn(async () => ({ ok: true as const, value: { application: 'applied' } })) } },
  })
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('layout', { panelInfo } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const select = (id: string | null): void => { panelInfo.set({ activePanelId: id }) }
  const entry = (name: string): Recorded => registered.find(item => item.options.name === name)!
  return { ctx, registered, dictionaries, fiber, remote, mcp, select, entry }
}

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('ui-mcp-manager apply', () => {
  it('declares its services and constants', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcp', 'layout'])
    expect(NS).toBe('mcpManager')
    expect(PANEL_ID).toBe('mcp')
  })

  it('registers the dictionaries, main page, and sidebar entry', async () => {
    const b = await boot()
    try {
      expect(b.dictionaries.get(NS)).toEqual({ zh, en })
      const main = b.entry('main')
      expect(main.component).toBe(McpPanel)
      expect(main.options).toMatchObject({ key: PANEL_ID, locale: NS })
      const sidebar = b.entry('sidebar.panellist')
      expect(sidebar.component).toBe(McpPanelIcon)
      expect(sidebar.options).toMatchObject({ id: PANEL_ID, order: 1, locale: NS })
      expect(sidebar.options.label?.()).toBe('panel')
      const face = main.options.inject!()
      expect(face.canToggle).toBe(true)
      expect(face.hooks.catalog.getSnapshot().phase).toBe('loading')
      // One navigation instance backs every create call of the store.
      expect(main.options.store!.create()).toBe(main.options.store!.create())
    } finally { await b.fiber.dispose() }
  })

  it('delegates the face to the catalog', async () => {
    const b = await boot()
    try {
      const face = b.entry('main').options.inject!()
      const draft = { serverName: 'a', transport: 'stdio', command: 'x' } as const
      await face.create(draft)
      expect(b.mcp.create).toHaveBeenCalledWith(draft)
      await face.update('e1', draft)
      expect(b.mcp.update).toHaveBeenCalledWith('e1', draft)
      await face.remove('e1')
      expect(b.mcp.removeServer).toHaveBeenCalledWith('e1')
      await face.reconnect('e1', { acceptOrphan: true })
      expect(b.mcp.reconnect).toHaveBeenCalledWith('e1', { acceptOrphan: true })
      expect((await face.setEnabled('e1', true)).kind).toBe('completed')
      await face.refresh()
    } finally { await b.fiber.dispose() }
  })

  it('works without Plugin Manager', async () => {
    const b = await boot({ withManager: false })
    try {
      const face = b.entry('main').options.inject!()
      expect(face.canToggle).toBe(false)
      expect(await face.setEnabled('e1', true)).toEqual({ kind: 'unavailable' })
    } finally { await b.fiber.dispose() }
  })

  it('ignores change events before the page was opened, then refreshes after', async () => {
    const b = await boot()
    try {
      b.remote.emit('mcp/change', [])
      b.remote.emit('plugin-manager/changed', [])
      b.ctx.emit('connection/reset')
      await flush()
      expect(b.mcp.list).not.toHaveBeenCalled()
      b.select(PANEL_ID)
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(1) })
      b.remote.emit('mcp/change', [])
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(2) })
      b.remote.emit('plugin-manager/changed', [])
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(3) })
      b.ctx.emit('connection/reset')
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(4) })
    } finally { await b.fiber.dispose() }
  })

  it('refreshes only when the panel becomes selected, and resets navigation on deselect', async () => {
    const b = await boot()
    try {
      const nav = b.entry('main').options.store!.create()
      b.select(PANEL_ID)
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(1) })
      nav.actions.openCreate()
      b.select(PANEL_ID)
      await flush()
      expect(b.mcp.list).toHaveBeenCalledTimes(1)
      expect(nav.getSnapshot().view).toEqual({ kind: 'create' })
      b.select('other')
      expect(nav.getSnapshot().view).toEqual({ kind: 'list' })
      b.select(PANEL_ID)
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(2) })
    } finally { await b.fiber.dispose() }
  })

  it('refreshes on change when the panel is already active at boot', async () => {
    const b = await boot({ active: PANEL_ID })
    try {
      b.remote.emit('mcp/change', [])
      await vi.waitFor(() => { expect(b.mcp.list).toHaveBeenCalledTimes(1) })
    } finally { await b.fiber.dispose() }
  })
})
