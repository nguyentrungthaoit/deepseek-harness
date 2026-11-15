/** Attention classification derived from Session status facts. */
import { describe, expect, it } from 'vitest'
import { SESSION_ACTIVITY_RANK, sessionActivity, type SessionPendingInteraction, type SessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const idle: SessionStatus = { running: false, pendingInteraction: undefined, completionUnread: false }
const pending = { key: 'k', kind: 'approval', sessionId: 's' as SessionId } as SessionPendingInteraction

describe('sessionActivity', () => {
  it('classifies by precedence', () => {
    expect(sessionActivity(undefined)).toBe('idle')
    expect(sessionActivity(idle)).toBe('idle')
    expect(sessionActivity({ ...idle, running: true })).toBe('running')
    expect(sessionActivity({ ...idle, completionUnread: true })).toBe('unread')
    expect(sessionActivity({ running: true, pendingInteraction: pending, completionUnread: true })).toBe('waiting')
  })

  it('ranks waiting before running before unread before idle', () => {
    const ranks = (['waiting', 'running', 'unread', 'idle'] as const).map(a => SESSION_ACTIVITY_RANK[a])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})
