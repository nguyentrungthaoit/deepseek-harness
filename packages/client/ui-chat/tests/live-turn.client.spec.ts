import { describe, expect, it } from 'vitest'
import { estimateTokens, liveToolCalls, reasoningLine, reasoningLineOffset, streamedChars } from '../src/client/chat/live-turn.ts'

describe('live Turn readings', () => {
  it('reads no reasoning line between requests, outside reasoning, or on a blank line', () => {
    expect(reasoningLine(null)).toBe('')
    expect(reasoningLineOffset(null)).toBe(-1)
    expect(reasoningLine({ turn: 1, step: 1, blocks: [] })).toBe('')
    expect(reasoningLine({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'hi' }] })).toBe('')
    expect(reasoningLine({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: ' \n  ' }] })).toBe('')
    expect(reasoningLineOffset({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'a\nb' }] })).toBe(2)
  })

  it('estimates nothing for an idle Turn', () => {
    expect(streamedChars(null)).toBe(0)
    expect(estimateTokens(0)).toBe(0)
    expect(liveToolCalls([], [], 0)).toEqual([])
  })
})
