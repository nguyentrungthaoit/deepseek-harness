/** The latest Turn folds into ordered spans, live counts, and its cache-hit share. */
import { describe, expect, it } from 'vitest'
import {
  deriveTurnActivity, isSubagentCall, outputKind, partialKind, turnCacheHit,
} from '../src/client/activity.ts'
import { assistant, chat, result, running } from './fixtures.client.ts'

describe('deriveTurnActivity', () => {
  it('returns null without a snapshot or a recorded Turn start', () => {
    expect(deriveTurnActivity(undefined)).toBeNull()
    expect(deriveTurnActivity(chat([]))).toBeNull()
    expect(deriveTurnActivity(chat([{ turn: 1 }], { missing: [2] }))).toBeNull()
  })

  it('folds the latest started Turn into model and Tool spans in start order', () => {
    const activity = deriveTurnActivity(chat([
      { turn: 0, start: 10, end: 20 },
      {
        turn: 1,
        start: 100,
        end: 900,
        steps: [{ step: 0, start: 110, end: 500 }, { step: 1, start: 510, end: 890 }, { step: 2 }],
      },
      { turn: 2 },
    ], {
      nodes: [
        assistant({ turn: 0, step: 0, time: 15 }),
        assistant({
          turn: 1, step: 0, time: 300,
          blocks: [{ kind: 'reasoning', text: 'hm' }, { kind: 'tool-call', callId: 'a', name: 'read', argsRaw: '{}' }],
          timing: { stepStartTime: 110, firstTokenTime: 150, completedTime: 290 },
        }),
        assistant({
          turn: 1, step: 1, time: 880,
          blocks: [{ kind: 'reasoning', text: 'done' }],
          timing: { stepStartTime: 510, firstTokenTime: 510, completedTime: 870 },
        }),
        result({
          callId: 'a', name: 'read', callTime: 300, time: 480, isError: true,
          subCalls: [
            result({ callId: 'a.1', name: 'grep', callTime: 310, time: 320, parentCallId: 'a' }),
            result({ callId: 'a.2', name: 'lost', callTime: null, time: 330, parentCallId: 'a' }),
            running({ callId: 'a.3', name: 'glob', turn: 1, step: 0, time: 340 }),
            running({ callId: 'a.4', name: 'subagent_fork', turn: 1, step: 0, time: 345 }),
          ],
        }),
        result({ callId: 'child', name: 'grep', callTime: 305, time: 315, parentCallId: 'a' }),
        result({ callId: 'early', name: 'old', callTime: 50, time: 60 }),
        result({ callId: 'late', name: 'next', callTime: 950, time: 960 }),
        result({ callId: 'cut', name: 'cut', callTime: null, time: 400 }),
        { kind: 'user', seq: 1, time: 100, content: [], source: null },
      ],
    }))
    expect(activity).toMatchObject({ turn: 1, start: 100, end: 900, runningTools: 1, runningSubagents: 1, cacheHit: null })
    expect(activity?.spans.map(span => [span.key, span.kind, span.depth, span.start, span.end, span.failed])).toEqual([
      ['step:0', 'writing', 0, 110, 290, false],
      ['call:a', 'tool', 0, 300, 480, true],
      ['call:a.1', 'tool', 1, 310, 320, false],
      ['call:a.3', 'tool', 1, 340, null, false],
      ['call:a.4', 'subagent', 1, 345, null, false],
      ['step:1', 'thinking', 0, 510, 870, false],
    ])
    expect(activity?.spans[0]?.firstToken).toBe(150)
    expect(activity?.spans[5]?.firstToken).toBeUndefined()
    expect(activity?.spans[1]?.name).toBe('read')
  })

  it('draws streaming, waiting, and failed-request steps of an open Turn', () => {
    const activity = deriveTurnActivity(chat([{
      turn: 3,
      start: 1_000,
      steps: [
        { step: 0, start: 1_010, end: 1_020 },
        { step: 1, start: 1_030 },
        { step: 2, start: 1_040 },
        { step: 3, start: 1_050 },
        { step: 4, start: 1_060 },
      ],
    }], {
      nodes: [assistant({ turn: 3, step: 0, time: 1_015, blocks: [] })],
      partial: { turn: 3, step: 1, blocks: [{ kind: 'text', text: 'x' }] },
      runningCalls: [
        running({ callId: 'b', name: 'subagent', turn: 3, step: 2, time: 1_045 }),
        running({ callId: 'p', name: 'bash', turn: 3, step: 3, time: 1_055, phase: 'preparing' }),
        running({ callId: 'o', name: 'bash', turn: 2, step: 0, time: 900 }),
      ],
    }))
    expect(activity?.end).toBeNull()
    expect(activity?.spans.map(span => [span.key, span.kind, span.end])).toEqual([
      ['step:0', 'waiting', 1_015],
      ['step:1', 'writing', null],
      ['call:b', 'subagent', null],
      ['step:4', 'waiting', null],
    ])
    expect(activity).toMatchObject({ runningTools: 0, runningSubagents: 1 })
  })

  it('marks a closed step without a message as a waiting span to its end', () => {
    const activity = deriveTurnActivity(chat([{ turn: 0, start: 0, end: 50, steps: [{ step: 0, start: 5, end: 40 }] }], {
      partial: { turn: 0, step: 9, blocks: [] },
    }))
    expect(activity?.spans.map(span => [span.kind, span.start, span.end])).toEqual([['waiting', 5, 40]])
    const otherTurn = deriveTurnActivity(chat([{ turn: 0, start: 0, steps: [{ step: 0, start: 5 }] }], {
      partial: { turn: 7, step: 0, blocks: [] },
    }))
    expect(otherTurn?.spans.map(span => [span.kind, span.end])).toEqual([['waiting', null]])
  })
})

describe('span classification', () => {
  it('recognizes subagent delegation names', () => {
    expect(isSubagentCall('subagent')).toBe(true)
    expect(isSubagentCall('subagent_explore')).toBe(true)
    expect(isSubagentCall('list_agents')).toBe(false)
  })

  it('classifies finished and streaming output', () => {
    expect(outputKind([])).toBe('waiting')
    expect(outputKind([{ kind: 'reasoning', text: 'a' }])).toBe('thinking')
    expect(outputKind([{ kind: 'reasoning', text: 'a' }, { kind: 'text', text: 'b' }])).toBe('writing')
    expect(partialKind({ turn: 0, step: 0, blocks: [] })).toBe('waiting')
    expect(partialKind({ turn: 0, step: 0, blocks: [{ kind: 'text', text: 'a' }, { kind: 'reasoning', text: 'b' }] })).toBe('thinking')
    expect(partialKind({ turn: 0, step: 0, blocks: [{ kind: 'reasoning', text: 'b' }, { kind: 'text', text: 'a' }] })).toBe('writing')
  })
})

describe('turnCacheHit', () => {
  it('divides cache reads by all prompt-side input over reporting steps', () => {
    expect(turnCacheHit([
      assistant({ turn: 0, step: 0, time: 1, usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 300 } }),
      assistant({ turn: 0, step: 1, time: 2, usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 450, cacheWriteTokens: 100 } }),
      assistant({ turn: 0, step: 2, time: 3, usage: { inputTokens: 'many' } }),
      assistant({ turn: 0, step: 3, time: 4, usage: null }),
      assistant({ turn: 0, step: 4, time: 5, usage: 'n/a' }),
      assistant({ turn: 0, step: 5, time: 6 }),
    ])).toBe(0.75)
  })

  it('omits the share when no step reported cache reads or input is zero', () => {
    expect(turnCacheHit([assistant({ turn: 0, step: 0, time: 1, usage: { inputTokens: 10, cacheReadTokens: -1 } })])).toBeNull()
    expect(turnCacheHit([assistant({ turn: 0, step: 0, time: 1, usage: { inputTokens: 0, cacheReadTokens: 0 } })])).toBeNull()
    expect(turnCacheHit([])).toBeNull()
  })

  it('reports the share on a folded Turn', () => {
    const activity = deriveTurnActivity(chat([{ turn: 0, start: 0, end: 9 }], {
      nodes: [assistant({ turn: 0, step: 0, time: 5, usage: { inputTokens: 1, cacheReadTokens: 3 } })],
    }))
    expect(activity?.cacheHit).toBe(0.75)
  })
})
