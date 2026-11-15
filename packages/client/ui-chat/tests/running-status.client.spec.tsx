// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { RunningStatus } from '../src/client/chat/RunningStatus.tsx'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot, type PartialAssistant, type RunningToolCall } from '../src/client/contract/snapshot.ts'
import type { StallWarningThresholds } from '../src/client/stall-warning.ts'
import { en, zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonEn)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function chatWith(partial: PartialAssistant | null, runningCalls: readonly RunningToolCall[] = []): ChatSnapshot {
  return { ...EMPTY_CHAT_SNAPSHOT, legacy: { ...EMPTY_CHAT_SNAPSHOT.legacy, partial, runningCalls } }
}

function bash(time: number, callId = 'c1'): RunningToolCall {
  return { phase: 'start', callId, name: 'bash', turn: 1, step: 1, time, subCalls: [], args: PartialArguments.EMPTY, argsRaw: '{}' }
}

function statusHarness(startTime?: number, translate = t, liveDetails = false) {
  const chat = createSnapshotStore<ChatSnapshot>(chatWith(null))
  const thresholds = createSnapshotStore<StallWarningThresholds>({ model: 60, tool: 120 })
  const live = createSnapshotStore(liveDetails)
  const element = (nextStartTime?: number) => (
    <RunningStatus
      startTime={nextStartTime}
      useChat={bindSnapshotSelector(chat)}
      useStallWarning={bindSnapshotSelector(thresholds)}
      useLiveActivity={bindSnapshotSelector(live)}
      t={translate}
    />
  )
  const view = render(element(startTime))
  const root = () => view.container.querySelector('[data-chat-running]')
  return {
    ...view,
    chat,
    thresholds,
    live,
    details: () => view.container.querySelector('[data-live-details]'),
    content: () => view.container.querySelector('[data-chat-running] > :last-child'),
    label: () => view.container.querySelector('[data-shimmer="true"]')?.textContent,
    activity: () => view.container.querySelector('[data-running-activity]'),
    stalled: () => root()?.hasAttribute('data-stalled'),
    set: (nextStartTime?: number) => { view.rerender(element(nextStartTime)) },
  }
}

describe('RunningStatus', () => {
  it('waits for an open Turn start before allocating its clock', () => {
    const view = statusHarness()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(view.activity()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.querySelectorAll('[data-shimmer="true"]')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the indicator mounted while a continuous run moves to the next Turn', () => {
    const view = statusHarness(1_000)
    const content = view.content()
    const status = view.getByRole('status')
    const initialText = view.label()
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.label()).not.toBe(initialText)
    view.set(7_000)
    expect(view.content()).toBe(content)
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(vi.getTimerCount()).toBe(1)
    const nextTurnText = view.label()
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.label()).not.toBe(nextTurnText)
    expect(view.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('深度求索中')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the duration nonnegative when the start is ahead of the local clock', () => {
    const view = statusHarness(6_000)
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.label()).not.toContain('-')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.label()).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.label()).not.toContain('-')
  })

  it('names the current activity and restarts the wait clock on progress', () => {
    const view = statusHarness(1_000, tEn)
    expect(view.activity()?.textContent).toBe('Waiting for the model 1s')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(view.activity()?.textContent).toBe('Waiting for the model 10s')
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'hm' }] })) })
    expect(view.activity()?.getAttribute('data-running-activity')).toBe('thinking')
    expect(view.activity()?.textContent).toBe('Thinking')
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'Hi' }] })) })
    expect(view.activity()?.textContent).toBe('Writing')
    act(() => { view.chat.set(chatWith(null, [bash(Date.now() - 3_000), bash(Date.now(), 'c2')])) })
    expect(view.activity()?.textContent).toBe('Running bash and 2 more 3s')
    act(() => { view.chat.set(chatWith(null)) })
    expect(view.activity()?.textContent).toBe('Waiting for the model 1s')
    expect(view.stalled()).toBe(false)
  })

  it('warns once a phase passes its threshold and announces without the ticking duration', () => {
    const view = statusHarness(1_000, tEn)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(view.stalled()).toBe(true)
    expect(view.activity()?.textContent).toBe('No response from the model for 1m 0s')
    expect(view.getByRole('status').textContent).toBe('Deep diving · Possibly stalled')

    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'Hi' }] })) })
    expect(view.stalled()).toBe(false)
    expect(view.getByRole('status').textContent).toBe('Deep diving')
    act(() => { vi.advanceTimersByTime(61_000) })
    expect(view.activity()?.textContent).toBe('No new output for 1m 1s')

    act(() => { view.chat.set(chatWith(null, [bash(Date.now())])) })
    expect(view.stalled()).toBe(false)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(view.activity()?.textContent).toBe('bash has been running for 2m 0s')

    act(() => { view.thresholds.set({ model: 60, tool: 0 }) })
    expect(view.stalled()).toBe(false)
    expect(view.activity()?.textContent).toBe('Running bash 2m 0s')
  })
})

function settledChat(
  nodes: ChatSnapshot['legacy']['nodes'],
  partial: PartialAssistant | null = null,
  runningCalls: readonly RunningToolCall[] = [],
): ChatSnapshot {
  return { ...EMPTY_CHAT_SNAPSHOT, legacy: { ...EMPTY_CHAT_SNAPSHOT.legacy, nodes, partial, runningCalls } }
}

function result(callId: string, name: string, callTime: number, time: number, isError = false): Extract<ChatSnapshot['legacy']['nodes'][number], { kind: 'tool-result' }> {
  return {
    kind: 'tool-result', seq: time, time, callId, name, args: PartialArguments.EMPTY,
    call: { name, argsRaw: '{}' }, callTime, content: [], isError, subCalls: [],
  }
}

describe('RunningStatus live details', () => {
  it('stays hidden when switched off or before the Turn start is known', () => {
    const off = statusHarness(1_000, tEn)
    act(() => { off.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'Plan' }] })) })
    expect(off.details()).toBeNull()
    act(() => { off.live.set(true) })
    expect(off.details()?.textContent).toContain('Plan')
    off.set()
    expect(off.details()).toBeNull()
  })

  it('renders nothing while the Turn has produced nothing yet', () => {
    const view = statusHarness(1_000, tEn, true)
    expect(view.details()).toBeNull()
  })

  it('ticks the latest reasoning line, then counts output and the streaming rate', () => {
    const view = statusHarness(1_000, tEn, true)
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'First idea\nCheck the tests  \n' }] })) })
    const ticker = () => view.container.querySelector('[data-live-reasoning]')
    const tokens = () => view.container.querySelector('[data-live-tokens]')
    expect(ticker()?.textContent).toBe('Check the tests')
    expect(tokens()?.textContent).toBe('~8 tok out')
    const line = ticker()?.firstElementChild
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'First idea\nCheck the tests now' }] })) })
    expect(ticker()?.firstElementChild).toBe(line)
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'First idea\nCheck the tests now\nRun them' }] })) })
    expect(ticker()?.textContent).toBe('Run them')
    expect(ticker()?.firstElementChild).not.toBe(line)
    act(() => { vi.advanceTimersByTime(2_000) })
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'x'.repeat(400) }] })) })
    expect(ticker()).toBeNull()
    expect(tokens()?.textContent).toBe('~100 tok out·47 tok/s')
  })

  it('prefers reported usage of settled steps and lists Tool calls newest first', () => {
    const view = statusHarness(1_000, tEn, true)
    const before = result('old', 'read_file', 100, 500)
    const answer = {
      kind: 'assistant' as const, seq: 1_500, time: 1_500, turn: 1, step: 1,
      blocks: [{ kind: 'text' as const, text: 'Looking' }], usage: { outputTokens: 1_200 },
    }
    const nested = { ...result('n1', 'inner', 1_700, 1_800), parentCallId: 'c0' }
    act(() => {
      view.chat.set(settledChat([before, answer, result('c1', 'read_file', 1_600, 1_900), nested, result('c2', 'edit', 2_000, 3_500, true)], null, [
        bash(Date.now() - 12_000, 'c3'),
        { phase: 'preparing', callId: 'c4', name: 'grep', turn: 1, step: 2, time: Date.now(), subCalls: [], args: PartialArguments.EMPTY },
      ]))
    })
    expect(view.container.querySelector('[data-live-tokens]')?.textContent).toBe('1.2K tok out')
    const list = view.container.querySelector('[data-live-tools]')
    expect(list?.getAttribute('aria-label')).toBe('4 tool calls this turn')
    const chips = [...list!.querySelectorAll('li')].map(chip => [chip.getAttribute('data-status'), chip.textContent, chip.getAttribute('title')])
    expect(chips).toEqual([
      ['preparing', 'grep', 'grep: preparing'],
      ['running', 'bash12s', 'bash: running'],
      ['failed', 'edit1s', 'edit: failed'],
      ['done', 'read_file<1s', 'read_file: done'],
    ])
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(list!.querySelectorAll('li')[1]?.textContent).toBe('bash13s')
  })

  it('estimates settled steps without reported usage and names the chips in Chinese', () => {
    const view = statusHarness(1_000, t, true)
    const answer = {
      kind: 'assistant' as const, seq: 1_500, time: 1_500, turn: 1, step: 1,
      blocks: [
        { kind: 'reasoning' as const, text: 'abcd' },
        { kind: 'tool-call' as const, callId: 'c1', name: 'bash', argsRaw: '{"a":1}' },
        { kind: 'other' as const, block: {} },
      ],
    }
    act(() => { view.chat.set(settledChat([answer, result('c1', 'bash', 1_600, 4_000)])) })
    expect(view.container.querySelector('[data-live-tokens]')?.textContent).toBe('输出约 3 tok')
    expect(view.container.querySelector('[data-live-tools] li')?.getAttribute('title')).toBe('bash：已完成')
    expect(view.container.querySelector('[data-live-tools] li')?.textContent).toBe('bash2秒')
  })
})

describe('RunningStatus outcomes', () => {
  it('slides measured edits through a ticker and shows the latest test run', () => {
    const view = statusHarness(1_000, tEn, true)
    const edit = {
      ...result('e1', 'edit', 1_100, 1_200),
      meta: { diffs: [{ path: '/work/repo/src/foo.ts', oldText: 'a\nb\nc\nd', newText: 'a\nB\nC' }] },
    }
    const tests = {
      ...result('b1', 'bash', 1_300, 1_400),
      content: [{ type: 'text' as const, text: '      Tests  2 failed | 128 passed | 5 skipped (135)' }],
    }
    act(() => { view.chat.set(settledChat([edit])) })
    const outcomes = () => view.container.querySelector('[data-live-outcomes]')
    const ticker = () => view.container.querySelector('[data-live-edits]')
    expect(view.container.querySelector('[data-test-scoreboard]')).toBeNull()
    expect(ticker()?.getAttribute('aria-label')).toBe('Edits this turn')
    expect(ticker()?.querySelector('li')?.textContent).toBe('+2−3src/foo.ts')
    expect(ticker()?.querySelector('li')?.getAttribute('title')).toBe('/work/repo/src/foo.ts: 2 lines added, 3 removed')
    act(() => { view.chat.set(settledChat([edit, tests])) })
    const board = view.container.querySelector('[data-test-scoreboard]')
    expect(board?.hasAttribute('data-failed')).toBe(true)
    expect(board?.textContent).toBe('Tests: 128 passed, 2 failed, 5 skipped✔ 128✘ 2⏭ 5')
    act(() => { view.chat.set(settledChat([{ ...tests, content: [{ type: 'text' as const, text: 'Tests:       4 passed, 4 total' }] }])) })
    expect(view.container.querySelector('[data-test-scoreboard]')?.hasAttribute('data-failed')).toBe(false)
    expect(ticker()).toBeNull()
    act(() => { view.chat.set(settledChat([result('r1', 'read', 1_100, 1_200)])) })
    expect(outcomes()).toBeNull()
  })
})

describe('RunningStatus reasoning rain', () => {
  const thinking = chatWith({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'weigh the options' }] })

  function stubMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
  }

  function stubCanvas() {
    const painter = {
      globalAlpha: 1, fillStyle: '', font: '',
      scale: vi.fn(), clearRect: vi.fn(), fillText: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === '2d' ? painter : null) as HTMLCanvasElement['getContext'])
    return painter
  }

  it('is not rendered under reduced motion or without a motion preference', () => {
    const view = statusHarness(1_000, tEn, true)
    act(() => { view.chat.set(thinking) })
    expect(view.container.querySelector('[data-reasoning-rain]')).toBeNull()
    view.unmount()
    stubMotion(true)
    const reduced = statusHarness(1_000, tEn, true)
    act(() => { reduced.chat.set(thinking) })
    expect(reduced.container.querySelector('[data-reasoning-rain]')).toBeNull()
  })

  it('animates only while thinking and the document is visible', () => {
    stubMotion(false)
    const painter = stubCanvas()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const view = statusHarness(1_000, tEn, true)
    const rain = () => view.container.querySelector('[data-reasoning-rain]')
    expect(rain()).toBeNull()
    act(() => { view.chat.set(thinking) })
    expect(rain()?.getAttribute('aria-hidden')).toBe('true')
    expect(painter.scale).toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    frames[0]?.(16)
    frames[1]?.(5_000)
    expect(painter.clearRect).toHaveBeenCalledTimes(2)
    expect(frames).toHaveLength(3)
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(frames).toHaveLength(3)
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(frames).toHaveLength(4)
    act(() => { view.chat.set(chatWith({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'Answer' }] })) })
    expect(rain()).toBeNull()
    expect(cancel).toHaveBeenCalled()
  })

  it('draws nothing where the canvas has no 2D context', () => {
    stubMotion(false)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const frames = vi.fn()
    vi.stubGlobal('requestAnimationFrame', frames)
    const view = statusHarness(1_000, tEn, true)
    act(() => { view.chat.set(thinking) })
    expect(view.container.querySelector('[data-reasoning-rain]')).not.toBeNull()
    expect(frames).not.toHaveBeenCalled()
  })
})
