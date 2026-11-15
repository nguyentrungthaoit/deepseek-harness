// @vitest-environment jsdom
/** Activity body: meters from real sources only, the flame graph, and a clock that runs only for a visible open Turn. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { JobsSnapshot, JobView } from '@deepseek-ai/dsh-api-job-controller/client'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import { ActivityPanel, type ActivityPanelProps } from '../src/client/ActivityPanel.tsx'
import { en } from '../src/client/locales.ts'
import type { SpeedSample } from '../src/client/speed.ts'
import { assistant, chat, result, running, type ChatInput } from './fixtures.client.ts'

beforeEach(() => { vi.useFakeTimers({ now: 10_000 }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function hook<T>(store: SnapshotStore<T>) {
  return function useStore<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot()))
  }
}

function job(id: string, status: JobView['status'], owner = 'session'): JobView {
  return { id, kind: 'bash', label: id, owner, status, startedAt: 0 } as JobView
}

function mount(options: {
  chat?: ChatInput | undefined
  pressure?: ContextPressureProjection | undefined
  jobs?: readonly JobView[]
  visible?: boolean
  history?: readonly SpeedSample[]
  repository?: WorkspaceRepository | null
} = {}) {
  const chatStore = createSnapshotStore<ChatInput | undefined>(options.chat)
  const jobsStore = createSnapshotStore<JobsSnapshot>({ rows: options.jobs === undefined ? {} : { session: options.jobs }, observed: {} })
  const speedStore = createSnapshotStore<readonly SpeedSample[]>(options.history ?? [])
  const recordSpeed = vi.fn()
  const loadGit = vi.fn((_signal: AbortSignal) => Promise.resolve(options.repository ?? null))
  const release = vi.fn()
  const watchJobs = vi.fn(() => release)
  const props = {
    sessionId: 'session',
    useChat: hook(chatStore),
    useJobs: hook(jobsStore),
    useSpeed: hook(speedStore),
    recordSpeed,
    loadGit,
    speedRecentRuns: 30,
    watchJobs,
    useProjection: (key: string) => key === 'contextPressure' ? options.pressure : undefined,
    useTabInfo: () => ({ tab: { visible: options.visible ?? true } }),
    t: makeTranslate(en, common),
  } as ActivityPanelProps
  const view = render(<ActivityPanel {...props} />)
  const meters = () => within(view.getByRole('region', { name: en['meters.label'] }))
  return { view, meters, chatStore, jobsStore, watchJobs, release, recordSpeed, loadGit, speedStore }
}

const FINISHED = chat([{ turn: 4, start: 1_000, end: 3_000, steps: [{ step: 0, start: 1_000, end: 2_900 }] }], {
  nodes: [
    assistant({
      turn: 4, step: 0, time: 1_500,
      usage: { inputTokens: 10, cacheReadTokens: 30 },
      timing: { stepStartTime: 1_000, firstTokenTime: 1_100, completedTime: 1_500 },
    }),
    result({
      callId: 'c1', name: 'read_file', callTime: 1_600, time: 2_000, isError: true,
      subCalls: [result({ callId: 'c2', name: 'grep', callTime: 1_700, time: 1_800, parentCallId: 'c1' })],
    }),
  ],
})

describe('ActivityPanel', () => {
  it('omits unreported meters and shows the empty timeline before any Turn', () => {
    const { view, watchJobs, release } = mount()
    expect(view.queryAllByRole('meter')).toEqual([])
    expect(view.getByText(en['timeline.empty'])).toBeTruthy()
    expect(view.getByText('Jobs 0')).toBeTruthy()
    expect(view.queryByText('Tools 0')).toBeNull()
    expect(watchJobs).toHaveBeenCalledOnce()
    view.unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('omits the context meter without a capacity', () => {
    expect(mount({ pressure: { pressureTokens: 10 } }).view.queryAllByRole('meter')).toEqual([])
    cleanup()
    expect(mount({ pressure: { pressureTokens: 10, contextWindow: 0 } }).view.queryAllByRole('meter')).toEqual([])
  })

  it('shows context, cache, running counts, and elapsed time for a finished Turn', () => {
    const { view, meters: section } = mount({
      chat: FINISHED,
      pressure: { pressureTokens: 50_000, projectedTokens: 64_000, contextWindow: 128_000 },
      jobs: [job('j1', 'running'), job('j2', 'stopping'), job('j3', 'completed')],
    })
    const meters = view.getAllByRole('meter')
    expect(meters.map(meter => [meter.getAttribute('aria-label'), meter.getAttribute('aria-valuenow'), meter.getAttribute('aria-valuetext')])).toEqual([
      ['Context', '50', '64K / 128K'],
      ['Cache hit', '75', '75%'],
    ])
    expect(view.getByText('Tools 0')).toBeTruthy()
    expect(view.getByText('Subagents 0')).toBeTruthy()
    expect(view.getByText('Jobs 2')).toBeTruthy()
    expect(section().getByText('2s')).toBeTruthy()
    const timeline = view.getByRole('region', { name: en['timeline.label'] })
    expect(within(timeline).getByRole('heading').textContent).toBe('Turn 4')
    expect(within(timeline).getByText(en['timeline.done'])).toBeTruthy()
    const bars = within(timeline).getAllByRole('img')
    expect(bars.map(bar => bar.getAttribute('aria-label'))).toEqual([
      'Step 0 · Writing · 500ms',
      'read_file · Failed · 400ms',
      'grep · Tool · 100ms',
    ])
    expect(bars[0]!.style.left).toBe('0%')
    expect(bars[0]!.style.width).toBe('25%')
    expect((bars[0]!.firstElementChild as HTMLElement).style.width).toBe('20%')
    expect(bars[1]!.firstElementChild).toBeNull()
    expect(within(timeline).getByText('read_file').style.paddingInlineStart).toBe('0px')
    expect(within(timeline).getByText('grep').style.paddingInlineStart).toBe('10px')
    expect([...timeline.lastElementChild!.children].map(tick => tick.textContent)).toEqual(['0ms', '500ms', '1s', '1.5s', '2s'])
  })

  it('grows running spans with the clock while the Turn is open and visible', () => {
    const open = chat([{ turn: 1, start: 9_000, steps: [{ step: 0, start: 9_000 }] }], {
      partial: { turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '…' }] },
      runningCalls: [running({ callId: 'x', name: 'subagent', turn: 1, step: 0, time: 9_500 })],
    })
    const { view, meters } = mount({ chat: open })
    expect(view.getByText(en['timeline.live'])).toBeTruthy()
    expect(view.getByText('Subagents 1')).toBeTruthy()
    expect(view.getByRole('img', { name: 'Step 0 · Thinking · 1s (running)' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(500) })
    expect(view.getByRole('img', { name: 'Step 0 · Thinking · 1.5s (running)' })).toBeTruthy()
    expect(view.getByRole('img', { name: 'subagent · Subagent · 1s (running)' })).toBeTruthy()
    expect(meters().getByText('1.5s')).toBeTruthy()
  })

  it('ticks once a second under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const open = chat([{ turn: 1, start: 9_000, steps: [{ step: 0, start: 9_000 }] }])
    const { view } = mount({ chat: open })
    expect(view.getByRole('img', { name: 'Step 0 · Waiting for model · 1s (running)' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(500) })
    expect(view.getByRole('img', { name: 'Step 0 · Waiting for model · 1s (running)' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(500) })
    expect(view.getByRole('img', { name: 'Step 0 · Waiting for model · 2s (running)' })).toBeTruthy()
  })

  it('stops the clock while the tab is hidden and reports a Turn without steps', () => {
    const { view, meters } = mount({ chat: chat([{ turn: 2, start: 9_000 }]), visible: false })
    expect(view.getByText(en['timeline.noSpans'])).toBeTruthy()
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(meters().getByText('1s')).toBeTruthy()
  })

  it('collapses a long Turn to its latest rows and expands on request', () => {
    const steps = Array.from({ length: 15 }, (_, step) => ({ step, start: 1_000 + step * 100, end: 1_090 + step * 100 }))
    const { view } = mount({ chat: chat([{ turn: 3, start: 1_000, end: 2_500, steps }]) })
    const timeline = within(view.getByRole('region', { name: en['timeline.label'] }))
    const names = () => timeline.getAllByRole('img').map(bar => bar.getAttribute('aria-label')!.split(' · ')[0])
    expect(names()).toEqual(Array.from({ length: 12 }, (_, index) => `Step ${index + 3}`))
    // The collapsed axis starts at Step 3 (300ms into the Turn) so the shown bars keep their width.
    const firstBar = timeline.getAllByRole('img')[0]!
    expect(firstBar.style.left).toBe('0%')
    expect(firstBar.style.width).toBe('7.5%')
    const toggle = timeline.getByRole('button', { name: 'Show all 15 (3 earlier hidden)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => { toggle.click() })
    expect(names()).toHaveLength(15)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Show only the latest 12')
    act(() => { toggle.click() })
    expect(names()).toHaveLength(12)
  })

  it('shows every row of a short Turn without a toggle', () => {
    const { view } = mount({ chat: FINISHED })
    expect(view.queryByRole('button')).toBeNull()
  })

  it('follows Chat publications', () => {
    const { view, chatStore } = mount()
    act(() => { chatStore.set(FINISHED) })
    expect(view.getByRole('heading', { name: 'Turn 4' })).toBeTruthy()
  })

  it('records the loaded step speeds and shows the model speed section', () => {
    const timed = chat([{ turn: 1, start: 1_000, end: 3_000, steps: [{ step: 0, start: 1_000, end: 2_900 }] }], {
      nodes: [assistant({
        turn: 1, step: 0, time: 2_000, model: 'deepseek-v4', usage: { outputTokens: 50 },
        timing: { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 },
      })],
    })
    const { view, recordSpeed } = mount({ chat: timed })
    expect(recordSpeed).toHaveBeenCalledWith([{ id: 'session:2000', time: 2_000, model: 'deepseek-v4', ttftMs: 500, tokensPerSecond: 100 }])
    // The fake store holds no samples, so the section waits for the history to include them.
    expect(view.queryByRole('region', { name: en['speed.label'] })).toBeNull()
  })

  it('falls back to the newest history model and hides the speed section without any history', () => {
    const history = [
      { id: 'a', time: 100, model: 'old', ttftMs: 100, tokensPerSecond: 10 },
      { id: 'b', time: 200, model: 'new', ttftMs: 200, tokensPerSecond: 20 },
    ]
    const { view, speedStore } = mount({ history })
    expect(within(view.getByRole('region', { name: en['speed.label'] })).getByText('new')).toBeTruthy()
    act(() => { speedStore.set([]) })
    expect(view.queryByRole('region', { name: en['speed.label'] })).toBeNull()
  })

  it('prefers the model of the latest step in this Session', () => {
    const history = [{ id: 'a', time: 100, model: 'other', ttftMs: 100, tokensPerSecond: 10 }, { id: 'b', time: 200, model: 'mine', ttftMs: 100, tokensPerSecond: 10 }]
    const own = chat([{ turn: 1, start: 1_000, end: 3_000 }], {
      nodes: [assistant({ turn: 1, step: 0, time: 2_000, model: 'other', timing: { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 } })],
    })
    const { view } = mount({ chat: own, history })
    expect(within(view.getByRole('region', { name: en['speed.label'] })).getByText('other')).toBeTruthy()
  })

  it('shows the git graph and re-reads when a Tool call settles or the Turn ends', async () => {
    const repository: WorkspaceRepository = {
      branch: 'main', files: 0, added: 0, deleted: 0,
      commits: [{ hash: 'a'.repeat(40), parents: [], time: 1_000, subject: 'init' }],
    }
    const open = chat([{ turn: 1, start: 9_000, steps: [{ step: 0, start: 9_000 }] }])
    const { view, chatStore, loadGit } = mount({ chat: open, repository })
    await act(async () => { await Promise.resolve() })
    expect(view.getByRole('region', { name: en['git.label'] })).toBeTruthy()
    expect(view.getByText('init')).toBeTruthy()
    expect(loadGit).toHaveBeenCalledTimes(1)
    act(() => { chatStore.set(chat([{ turn: 1, start: 9_000, steps: [{ step: 0, start: 9_000 }] }], { nodes: [result({ callId: 'c', name: 'bash', callTime: 9_100, time: 9_200 })] })) })
    await act(async () => { await Promise.resolve() })
    expect(loadGit).toHaveBeenCalledTimes(2)
    act(() => { chatStore.set(chat([{ turn: 1, start: 9_000, end: 9_900, steps: [{ step: 0, start: 9_000 }] }], { nodes: [result({ callId: 'c', name: 'bash', callTime: 9_100, time: 9_200 })] })) })
    await act(async () => { await Promise.resolve() })
    expect(loadGit).toHaveBeenCalledTimes(3)
  })

  it('hides the git graph outside a repository', async () => {
    const { view } = mount({ repository: null })
    await act(async () => { await Promise.resolve() })
    expect(view.queryByRole('region', { name: en['git.label'] })).toBeNull()
  })
})
