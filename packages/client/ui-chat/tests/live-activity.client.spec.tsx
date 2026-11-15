// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSettings } from '../src/chat-settings.ts'
import { LiveActivityPolicy, TurnReportPolicy } from '../src/client/live-activity.ts'
import { TurnReportRow, type TurnReportRowProps } from '../src/client/settings/TurnReportRow.tsx'
import type { TurnReportThreshold } from '../src/chat-settings.ts'
import { LiveActivityRow, type LiveActivityRowProps } from '../src/client/settings/LiveActivityRow.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

const BASE: ChatSettings = { linkOpening: 'sidebar', performanceUsage: 'detailed' }

describe('LiveActivityPolicy', () => {
  it('starts on and keeps an explicit choice live without persistence', async () => {
    const host = stubConfigForm<ChatSettings>()
    host.set.mockRejectedValue(new Error('memory-only scope'))
    const policy = new LiveActivityPolicy(host.scope)
    expect(policy.enabled.getSnapshot()).toBe(true)
    policy.setEnabled(false)
    expect(policy.enabled.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('liveActivity', false)
    await Promise.resolve()
    policy.setEnabled(false)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('adopts accepted Host settings and releases its subscription', () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({ value: { ...BASE, liveActivity: false } })
    const policy = new LiveActivityPolicy(host.scope)
    expect(policy.enabled.getSnapshot()).toBe(false)
    host.publish({ value: { ...BASE, liveActivity: false, linkOpening: 'new-tab' } })
    host.publish({ value: BASE })
    expect(policy.enabled.getSnapshot()).toBe(false)
    host.publish({ value: { ...BASE, liveActivity: true } })
    expect(policy.enabled.getSnapshot()).toBe(true)
    policy.dispose()
    expect(host.listenerCount()).toBe(0)
  })
})

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

function mount(dictionary: typeof en | typeof zh) {
  const source = createSnapshotStore(true)
  const setLiveActivity = vi.fn((enabled: boolean) => { source.set(enabled) })
  const props: LiveActivityRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    useSessionRetainInfo: () => undefined,
    useResource,
    useLiveActivity: bindSnapshotSelector(source),
    setLiveActivity,
    t: makeTranslate(dictionary),
  }
  render(<LiveActivityRow {...props} />)
  return setLiveActivity
}

describe('LiveActivityRow', () => {
  it('switches the live details off and back on', () => {
    const setLiveActivity = mount(en)
    expect(screen.getByText('Live activity details')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /On/ }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['On', 'Off'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(setLiveActivity).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: /Off/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'On' }))
    expect(setLiveActivity).toHaveBeenLastCalledWith(true)
  })

  it('uses the Chinese copy', () => {
    mount(zh)
    expect(screen.getByText('运行中实时详情')).toBeDefined()
    expect(screen.getByRole('button', { name: /开启/ })).toBeDefined()
  })
})

describe('TurnReportPolicy', () => {
  it('starts at two minutes, adopts accepted values, and persists choices', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new TurnReportPolicy(host.scope)
    expect(policy.value.getSnapshot()).toBe(120)
    host.publish({ value: { ...BASE, turnReport: 600 } })
    expect(policy.value.getSnapshot()).toBe(600)
    policy.set(0)
    expect(host.set).toHaveBeenCalledWith('turnReport', 0)
    expect(policy.value.getSnapshot()).toBe(0)
    policy.dispose()
    expect(host.listenerCount()).toBe(0)
  })
})

function mountReport(dictionary: typeof en | typeof zh) {
  const source = createSnapshotStore<TurnReportThreshold>(120)
  const setTurnReport = vi.fn((seconds: TurnReportThreshold) => { source.set(seconds) })
  const props: TurnReportRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    useSessionRetainInfo: () => undefined,
    useResource,
    useTurnReport: bindSnapshotSelector(source),
    setTurnReport,
    t: makeTranslate(dictionary),
  }
  render(<TurnReportRow {...props} />)
  return setTurnReport
}

describe('TurnReportRow', () => {
  it('offers Off and whole-minute thresholds', () => {
    const setTurnReport = mountReport(en)
    expect(screen.getByText('Turn report card')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /2 min/ }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Off', '1 min', '2 min', '5 min', '10 min'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(setTurnReport).toHaveBeenCalledWith(0)
  })

  it('uses the Chinese copy', () => {
    mountReport(zh)
    expect(screen.getByText('轮次小结卡片')).toBeDefined()
  })
})
