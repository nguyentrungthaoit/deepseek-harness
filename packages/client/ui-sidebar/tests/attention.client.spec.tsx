// @vitest-environment jsdom
/** Silent notifications, tab-title counter and the opt-in row. */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteraction, SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchAttention } from '../src/client/attention/attention.ts'
import { NotificationsRow, type NotificationsRowProps } from '../src/client/attention/NotificationsRow.tsx'
import { NOTIFICATIONS_STORAGE_KEY, NotificationPreference, type NotificationPreferenceState } from '../src/client/attention/preference.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const A = 'a' as SessionId
const B = 'b' as SessionId
const WARN = '⚠'

function pending(sessionId: SessionId, kind: string, key = 'k1'): SessionPendingInteraction {
  return { key, kind, sessionId } as SessionPendingInteraction
}
function status(over: Partial<SessionStatus> = {}): SessionStatus {
  return { running: false, pendingInteraction: undefined, completionUnread: false, ...over }
}

class FakeNotification {
  static instances: FakeNotification[] = []
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => FakeNotification.permission)
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(readonly title: string, readonly options: NotificationOptions) {
    FakeNotification.instances.push(this)
  }
}

function setFocus(focused: boolean, hidden = false) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

beforeEach(() => {
  FakeNotification.instances = []
  FakeNotification.permission = 'granted'
  FakeNotification.requestPermission.mockReset()
  FakeNotification.requestPermission.mockImplementation(async () => FakeNotification.permission)
  vi.stubGlobal('Notification', FakeNotification)
  localStorage.clear()
  document.title = 'DSH'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function summary(id: SessionId, mainId?: SessionId): SessionSummary {
  return {
    id, title: `Title ${id}`, displayTitle: `Title ${id}`, running: false, blank: false, updatedAt: 0,
    retainedBy: id === mainId ? { mainView: 1 } : {},
  }
}
function listState(...items: SessionSummary[]): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    phase: 'ready',
    projectionsBySession: {},
  }
}

function rig(mainId?: SessionId) {
  const statuses = createSnapshotStore<SessionStatusSnapshot>(new Map())
  const list = createSnapshotStore(listState(summary(A, mainId), summary(B, mainId)))
  const preference = new NotificationPreference()
  const stop = watchAttention({ statuses, list, preference, t })
  return { statuses, list, preference, stop }
}

describe('watchAttention', () => {
  it('notifies silently when a background session starts waiting, once per request', async () => {
    setFocus(true)
    const r = rig(A)
    await r.preference.setEnabled(true)
    r.statuses.set(new Map([[B, status({ pendingInteraction: pending(B, 'approval') })]]))
    expect(FakeNotification.instances).toHaveLength(1)
    const [n] = FakeNotification.instances
    expect(n!.title).toBe('Title b')
    expect(n!.options).toMatchObject({ body: 'Waiting for your approval', silent: true, tag: 'b:waiting' })
    expect(document.title).toBe(`(1${WARN}) DSH`)
    r.statuses.set(new Map([[B, status({ pendingInteraction: pending(B, 'approval'), running: true })]]))
    expect(FakeNotification.instances).toHaveLength(1)
    r.statuses.set(new Map([[B, status({ pendingInteraction: pending(B, 'question', 'k2') })]]))
    expect(FakeNotification.instances).toHaveLength(2)
    expect(FakeNotification.instances[1]!.options.body).toBe('Has a question for you')
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    n!.onclick!()
    expect(n!.close).toHaveBeenCalled()
    r.stop()
  })

  it('uses plan, generic and untitled copy', async () => {
    setFocus(false)
    const r = rig(A)
    await r.preference.setEnabled(true)
    r.statuses.set(new Map([
      [B, status({ pendingInteraction: pending(B, 'plan-review') })],
      ['zz' as SessionId, status({ pendingInteraction: pending('zz' as SessionId, 'other') })],
    ]))
    expect(FakeNotification.instances.map(n => [n.title, n.options.body])).toEqual([
      ['Title b', 'Plan ready for your review'],
      ['zz', 'Waiting for you'],
    ])
    r.stop()
  })

  it('notifies on completion, but not for the focused main session or when disabled', async () => {
    setFocus(true)
    const r = rig(A)
    r.statuses.set(new Map([[B, status({ running: true })], [A, status({ running: true })]]))
    r.statuses.set(new Map([[B, status()], [A, status()]]))
    expect(FakeNotification.instances).toHaveLength(0)
    await r.preference.setEnabled(true)
    r.statuses.set(new Map([[B, status({ running: true })], [A, status({ running: true })]]))
    r.statuses.set(new Map([[B, status({ completionUnread: true })], [A, status()]]))
    expect(FakeNotification.instances.map(n => n.options.body)).toEqual(['Finished'])
    setFocus(true, true)
    r.statuses.set(new Map([[B, status()], [A, status({ running: true })]]))
    r.statuses.set(new Map([[B, status()], [A, status()]]))
    expect(FakeNotification.instances).toHaveLength(2)
    r.stop()
  })

  it('does not notify for state that existed before watching and restores the title', () => {
    setFocus(false)
    const statuses = createSnapshotStore<SessionStatusSnapshot>(
      new Map([[B, status({ pendingInteraction: pending(B, 'approval') })]]),
    )
    const list = createSnapshotStore(listState())
    const preference = new NotificationPreference()
    const stop = watchAttention({ statuses, list, preference, t })
    expect(FakeNotification.instances).toHaveLength(0)
    expect(document.title).toBe(`(1${WARN}) DSH`)
    statuses.set(new Map([
      [B, status({ pendingInteraction: pending(B, 'approval') })],
      [A, status({ pendingInteraction: pending(A, 'approval') })],
    ]))
    expect(document.title).toBe(`(2${WARN}) DSH`)
    document.title = 'Other'
    statuses.set(new Map())
    expect(document.title).toBe('Other')
    statuses.set(new Map([[B, status({ pendingInteraction: pending(B, 'approval') })]]))
    stop()
    expect(document.title).toBe('Other')
  })

  it('re-reads the permission when the tab visibility changes', async () => {
    setFocus(true)
    const r = rig(A)
    await r.preference.setEnabled(true)
    FakeNotification.permission = 'denied'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(r.preference.state.getSnapshot()).toEqual({ enabled: false, support: 'denied' })
    r.stop()
    document.dispatchEvent(new Event('visibilitychange'))
  })
})

describe('NotificationPreference', () => {
  it('requests permission when undecided and persists a grant', async () => {
    FakeNotification.permission = 'default'
    FakeNotification.requestPermission.mockImplementation(async () => (FakeNotification.permission = 'granted'))
    const p = new NotificationPreference()
    expect(p.state.getSnapshot()).toEqual({ enabled: false, support: 'ready' })
    await p.setEnabled(true)
    expect(p.active).toBe(true)
    expect(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)).toBe('true')
    expect(new NotificationPreference().active).toBe(true)
    await p.setEnabled(false)
    expect(p.active).toBe(false)
    expect(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)).toBe('false')
  })

  it('stays off when permission is refused or already denied', async () => {
    FakeNotification.permission = 'default'
    FakeNotification.requestPermission.mockImplementation(async () => 'denied')
    const p = new NotificationPreference()
    await p.setEnabled(true)
    expect(p.active).toBe(false)
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce()
    FakeNotification.permission = 'denied'
    await p.setEnabled(true)
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce()
    expect(p.state.getSnapshot().support).toBe('denied')
  })

  it('reports an unsupported browser and ignores enabling', async () => {
    vi.stubGlobal('Notification', undefined)
    const p = new NotificationPreference()
    await p.setEnabled(true)
    expect(p.state.getSnapshot()).toEqual({ enabled: false, support: 'unsupported' })
  })

  it('tolerates blocked storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const p = new NotificationPreference()
    expect(p.active).toBe(false)
    await p.setEnabled(true)
    expect(p.active).toBe(true)
  })
})

describe('NotificationsRow', () => {
  function mount(state: NotificationPreferenceState) {
    const setNotifications = vi.fn()
    const props: Pick<NotificationsRowProps, 'useNotifications' | 'setNotifications' | 't'> = {
      useNotifications: selector => selector(state),
      setNotifications,
      t,
    }
    render(<NotificationsRow {...props as NotificationsRowProps} />)
    return setNotifications
  }

  it('toggles when supported', () => {
    const set = mount({ enabled: false, support: 'ready' })
    fireEvent.click(screen.getByRole('switch'))
    expect(set).toHaveBeenCalledWith(true)
    expect(screen.queryByText(en['settings.notifications.denied'])).toBeNull()
    expect(screen.queryByText(en['settings.notifications.unsupported'])).toBeNull()
  })

  it('explains a blocked or unsupported browser and disables the switch', () => {
    mount({ enabled: false, support: 'denied' })
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    expect(screen.getByText(en['settings.notifications.denied'])).toBeTruthy()
    cleanup()
    mount({ enabled: false, support: 'unsupported' })
    expect(screen.getByText(en['settings.notifications.unsupported'])).toBeTruthy()
  })
})
