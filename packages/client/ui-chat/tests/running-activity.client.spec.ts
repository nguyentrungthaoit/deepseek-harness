import { describe, expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { PartialAssistant, RunningToolCall } from '../src/client/contract/snapshot.ts'
import { progressMark, runningActivity, stalledFor } from '../src/client/chat/running-activity.ts'

function partial(...blocks: PartialAssistant['blocks']): PartialAssistant {
  return { turn: 1, step: 1, blocks }
}

function started(name: string, time: number): RunningToolCall {
  return { phase: 'start', callId: `${name}-${time}`, name, turn: 1, step: 1, time, subCalls: [], args: PartialArguments.EMPTY, argsRaw: '{}' }
}

function preparing(name: string): RunningToolCall {
  return { phase: 'preparing', callId: `${name}-p`, name, turn: 1, step: 1, time: 0, subCalls: [], args: PartialArguments.EMPTY }
}

const THRESHOLDS = { model: 120, tool: 300 } as const

describe('runningActivity', () => {
  it('waits for the model when nothing has streamed', () => {
    expect(runningActivity(null, [])).toEqual({ kind: 'waiting' })
    expect(runningActivity(partial(), [])).toEqual({ kind: 'waiting' })
  })

  it('reads reasoning as thinking and other output as writing', () => {
    expect(runningActivity(partial({ kind: 'text', text: 'a' }, { kind: 'reasoning', text: 'b' }), [])).toEqual({ kind: 'thinking' })
    expect(runningActivity(partial({ kind: 'reasoning', text: 'b' }, { kind: 'text', text: 'a' }), [])).toEqual({ kind: 'writing' })
    expect(runningActivity(partial({ kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{' }), [])).toEqual({ kind: 'writing' })
  })

  it('counts a call whose arguments are still streaming as model output', () => {
    expect(runningActivity(null, [preparing('bash')])).toEqual({ kind: 'writing' })
  })

  it('reports the longest-running dispatched call and how many run beside it', () => {
    const calls = [preparing('edit'), started('grep', 2_000), started('bash', 1_000), started('read', 3_000)]
    expect(runningActivity(partial({ kind: 'reasoning', text: 'x' }), calls))
      .toEqual({ kind: 'tool', name: 'bash', since: 1_000, others: 2 })
    expect(runningActivity(null, [started('bash', 1_000)])).toEqual({ kind: 'tool', name: 'bash', since: 1_000, others: 0 })
  })
})

describe('progressMark', () => {
  it('changes with streamed text, arguments, other blocks, calls, and Nodes', () => {
    const base = progressMark(null, [], 3)
    const marks = [
      base,
      progressMark(partial({ kind: 'text', text: 'ab' }), [], 3),
      progressMark(partial({ kind: 'text', text: 'abc' }), [], 3),
      progressMark(partial({ kind: 'text', text: 'abc' }, { kind: 'other', block: null }), [], 3),
      progressMark(partial({ kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{"a":1' }), [], 3),
      progressMark(null, [preparing('bash')], 3),
      progressMark(null, [started('bash', 1)], 3),
      progressMark(null, [], 4),
    ]
    expect(new Set(marks).size).toBe(marks.length)
    expect(progressMark(null, [], 3)).toBe(base)
  })
})

describe('stalledFor', () => {
  it('measures model phases from the last observed progress', () => {
    expect(stalledFor({ kind: 'waiting' }, 0, 119_999, THRESHOLDS)).toBeNull()
    expect(stalledFor({ kind: 'waiting' }, 0, 120_000, THRESHOLDS)).toBe(120_000)
    expect(stalledFor({ kind: 'thinking' }, 10_000, 200_000, THRESHOLDS)).toBe(190_000)
  })

  it('measures a Tool call from its dispatch against the Tool threshold', () => {
    const tool = { kind: 'tool', name: 'bash', since: 1_000, others: 0 } as const
    expect(stalledFor(tool, 290_000, 300_999, THRESHOLDS)).toBeNull()
    expect(stalledFor(tool, 290_000, 301_000, THRESHOLDS)).toBe(300_000)
  })

  it('never warns when a threshold is off or the clock is behind', () => {
    expect(stalledFor({ kind: 'waiting' }, 0, 10_000_000, { model: 0, tool: 300 })).toBeNull()
    expect(stalledFor({ kind: 'tool', name: 'bash', since: 0, others: 0 }, 0, 10_000_000, { model: 120, tool: 0 })).toBeNull()
    expect(stalledFor({ kind: 'waiting' }, 5_000, 1_000, { model: 60, tool: 0 })).toBeNull()
  })
})
