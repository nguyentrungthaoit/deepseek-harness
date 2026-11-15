/** Agent summary precedence and counts. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { summarizeAgents, type AgentSessionList, type AgentStatusFacts } from '../src/client/agent-status.ts'

const id = (value: string): SessionId => value as SessionId
const list = (ids: string[]): AgentSessionList => ({
  ids: ids.map(id),
  byId: Object.fromEntries(ids.map(value => [value, { displayTitle: `Title ${value}` }])),
})
const status = (entries: [string, Partial<AgentStatusFacts>][]): Map<SessionId, AgentStatusFacts> =>
  new Map(entries.map(([key, value]) => [id(key), {
    running: undefined, pendingInteraction: undefined, completionUnread: false, ...value,
  }]))

describe('summarizeAgents', () => {
  it('reports idle without activity', () => {
    expect(summarizeAgents(list([]), status([]))).toEqual({ running: 0, waiting: 0, done: 0, line: { kind: 'idle' } })
  })

  it('prefers a waiting Session, then running, then finished', () => {
    const pending = { key: 'k', kind: 'approval', sessionId: id('b') }
    expect(summarizeAgents(list(['a', 'b', 'c']), status([
      ['c', { completionUnread: true }], ['a', { running: true }], ['b', { running: true, pendingInteraction: pending }],
    ]))).toEqual({ running: 2, waiting: 1, done: 1, line: { kind: 'waiting', title: 'Title b', more: 0 } })
    expect(summarizeAgents(list(['a', 'b']), status([['b', { running: true }], ['a', { running: true }]])).line)
      .toEqual({ kind: 'running', title: 'Title a', more: 1 })
    expect(summarizeAgents(list(['a']), status([['a', { completionUnread: true }]])).line)
      .toEqual({ kind: 'done', title: 'Title a', more: 0 })
  })

  it('falls back to the id for a Session outside the list', () => {
    expect(summarizeAgents(list(['a']), status([['zz', { running: true }], ['yy', { running: true }]])).line)
      .toEqual({ kind: 'running', title: 'zz', more: 1 })
  })
})
