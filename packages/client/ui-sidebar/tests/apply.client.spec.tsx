// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
/** Sidebar shell slot registration and its Session/layout callbacks. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { HeaderLeadingControls } from '../src/client/HeaderLeadingControls.tsx'
import { apply as hostApply } from '../src/index.ts'
import type { NotificationsRowInjected } from '../src/client/attention/NotificationsRow.tsx'
import type { SessionPendingInteraction, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

function isNotificationsInjected(value: Record<string, unknown>): value is Record<string, unknown> & NotificationsRowInjected {
  return 'hooks' in value && 'setNotifications' in value
}

const owners = new Set<Fiber>()
afterEach(async () => {
  try {
    for (const owner of owners) await owner.dispose()
  } finally {
    owners.clear()
  }
})

function SidebarFrame({ renderSlot }: PropsRenderSlots<'sidebar'>) {
  return renderSlot('sidebar', { collapsed: false, width: 300 })
}

async function bench(declare = true) {
  const root = new Context()
  let ctx: Context | undefined
  const owner = root.plugin((owned: Context) => { ctx = owned })
  owners.add(owner)
  await owner.await()
  if (ctx === undefined) throw new Error('the sidebar fixture owner did not activate')
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn(), selectPanel: vi.fn() }
  const uiWorkspace = { startSession: vi.fn() }
  ctx.provide('shortcuts', { catalog: createSnapshotStore([]) } as never)
  ctx.provide('layout', layout)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { list: createSnapshotStore({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }) } as never)
  const sessionStatus = createSnapshotStore<SessionStatusSnapshot>(new Map())
  ctx.provide('uiSession', { sessionStatus } as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'shell.leading': { kind: 'single', scope: 'root' },
        'settings.general.item': { kind: 'list', scope: 'root' },
      } },
      SidebarFrame,
    )
  }
  return { ctx, slots, layout, uiWorkspace, sessionStatus }
}

describe('ui-sidebar apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'uiWorkspace', 'locale', 'shortcuts', 'sessions', 'uiSession'])
  })

  it('registers the shell and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.brand.name')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    expect(b.slots.spec('sidebar.panellist')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    // The window-chrome occupant reuses the shell's inject face and locale.
    const leading = b.slots.entries('shell.leading')
    expect(leading).toHaveLength(1)
    expect(leading[0]!.component).toBe(HeaderLeadingControls)
    expect(leading[0]!.locale).toBe('sidebar')
    expect(leading[0]!.inject).toBe(b.slots.entries('sidebar')[0]!.inject)
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'toggleSidebar', 'selectPanel', 'hooks'])
    expect(injected.hooks.panels.getSnapshot()).toEqual([])
    expect(b.slots.entries('main')).toEqual([])
    // Both arms delegate to the Workspace UI's shared New Session action.
    injected.startSession('workspace' as never)
    expect(b.uiWorkspace.startSession).toHaveBeenCalledWith('workspace')
    injected.startSession()
    expect(b.uiWorkspace.startSession).toHaveBeenLastCalledWith(undefined)
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
    const panelId = 'custom-panel' as MainPanelId
    injected.selectPanel(panelId)
    expect(b.layout.selectPanel).toHaveBeenCalledExactlyOnceWith(panelId)
    expectTypeOf<Parameters<SidebarRootInjected['selectPanel']>[0]>().toEqualTypeOf<MainPanelId>()
  })

  it('registers the notification row and mirrors waiting sessions in the tab title', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const rows = b.slots.entries('settings.general.item')
    expect(rows.map(row => row.options.id)).toEqual(['desktop-notifications'])
    const injected = rows[0]!.inject!()
    if (!isNotificationsInjected(injected)) throw new Error('the notification row did not inject its preference')
    expect(injected.hooks.notifications.getSnapshot().support).toBe('unsupported')
    injected.setNotifications(true)
    const statuses = b.sessionStatus
    document.title = 'DSH'
    const before = document.title
    statuses.set(new Map([['s' as SessionId, { running: false, completionUnread: false, pendingInteraction: { key: 'k', kind: 'question', sessionId: 's' as SessionId } as SessionPendingInteraction }]]))
    expect(document.title).toBe(`(1⚠) ${before}`)
    await fiber.dispose()
    expect(document.title).toBe(before)
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
  })

  it('waits for the sidebar declaration before registering', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    const disposeRoot = b.slots.register({
      name: 'root',
      children: { sidebar: { kind: 'single', scope: 'root' } },
    }, SidebarFrame)
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    disposeRoot()
    await fiber.dispose()
  })

  it('projects plugin-owned panel entries and removes them with their owner', async () => {
    const b = await bench()
    const sidebar = b.ctx.plugin({ inject: [...inject], apply })
    await sidebar.await()
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    const panel = b.ctx.plugin({
      inject: ['slots'],
      apply(ctx: Context) {
        ctx.slots.register({ name: 'main', key: 'custom-panel' }, () => 'Custom panel')
        ctx.slots.register({
          name: 'sidebar.panellist', id: 'custom-panel', order: 20, label: 'Custom panel',
        }, () => null)
      },
    })
    try {
      await panel.await()
      await vi.waitFor(() => {
        expect(injected.hooks.panels.getSnapshot()).toEqual([
          { id: 'custom-panel', order: 20, label: 'Custom panel' },
        ])
      })
      expect(b.slots.entries('main').map(entry => entry.options.key)).toEqual(['custom-panel'])
      await panel.dispose()
      await vi.waitFor(() => { expect(injected.hooks.panels.getSnapshot()).toEqual([]) })
      expect(b.slots.entries('main')).toEqual([])
    } finally {
      await panel.dispose()
      await sidebar.dispose()
    }
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('shell.leading')).toHaveLength(0)
    expect(b.slots.spec('sidebar.brand.mark')).toBeUndefined()
    expect(b.slots.spec('sidebar.brand.name')).toBeUndefined()
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
    expect(b.slots.spec('sidebar.panellist')).toBeUndefined()
    expect(b.slots.entries('main')).toHaveLength(0)
  })
})
