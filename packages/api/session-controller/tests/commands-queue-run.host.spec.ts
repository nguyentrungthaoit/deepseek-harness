/**
 * Queue reordering and starting a parked queue item against the production
 * AgentLoop: the moved or started item keeps its identity, the started item
 * runs first, and the remaining items follow in order.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { QueueAction } from '../src/types.ts'
import { createSessionTestRemote } from './test-remote.ts'

const message = (text: string): UserMessage => createUserMessage({
  content: [{ type: 'text', text }], source: { kind: 'user' },
})

function textOf(item: UserMessage): string {
  const [block] = item.content
  return block?.type === 'text' ? block.text : ''
}

function queuedTexts(agent: Agent): string[] {
  return agent.inbox.nextTurn.map(textOf)
}

function sentTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' ? [textOf(event.data)] : [])
}

async function harness(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] } as never)
  const agent = await loop.create('queue-run' as SessionId, { provider: 'mock', model: 'mock' })
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    cwd: '/tmp',
  })
  const update = (item: UserMessage, action: QueueAction) => remote.updateQueue({
    sessionId: agent.id, itemId: item.id, action,
  })
  return { ctx, adapter, agent, update }
}

describe('queue move and run', () => {
  it('reorders a parked queue one position at a time and ignores moves past either end', async () => {
    const { ctx, agent, update } = await harness([])
    try {
      const [a, b, c] = [message('a'), message('b'), message('c')]
      for (const item of [a, b, c]) agent.inbox.append('next-turn', item)

      expect(await update(b, { kind: 'move', direction: 'up' })).toEqual({ ok: true, value: { accepted: true } })
      expect(queuedTexts(agent)).toEqual(['b', 'a', 'c'])
      expect(await update(b, { kind: 'move', direction: 'up' })).toEqual({ ok: true, value: { accepted: true } })
      expect(queuedTexts(agent)).toEqual(['b', 'a', 'c'])
      await update(a, { kind: 'move', direction: 'down' })
      expect(queuedTexts(agent)).toEqual(['b', 'c', 'a'])
      await update(a, { kind: 'move', direction: 'down' })
      expect(queuedTexts(agent)).toEqual(['b', 'c', 'a'])
      expect(agent.inbox.nextTurn.map(item => item.id)).toEqual([b.id, c.id, a.id])
      expect(agent.status).toBe('idle')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('starts the chosen parked item first and drains the rest in order', async () => {
    const { ctx, adapter, agent, update } = await harness([
      textResponse('c reply'), textResponse('a reply'), textResponse('b reply'),
    ])
    try {
      const [a, b, c] = [message('a'), message('b'), message('c')]
      for (const item of [a, b, c]) agent.inbox.append('next-turn', item)

      expect(await update(c, { kind: 'run' })).toEqual({ ok: true, value: { accepted: true } })
      await agent.whenIdle()
      expect(sentTexts(agent)).toEqual(['c', 'a', 'b'])
      expect(adapter.requests).toHaveLength(3)
      expect(agent.inbox.nextTurn).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('starts a lone parked item, parks the rest after a failed turn, and resumes them', async () => {
    const { ctx, agent, update } = await harness([
      () => { throw new Error('provider down') },
      textResponse('b reply'),
    ])
    try {
      const [a, b] = [message('a'), message('b')]
      agent.inbox.append('next-turn', a)

      await update(a, { kind: 'run' })
      agent.inbox.append('next-turn', b)
      await agent.whenIdle()
      expect(sentTexts(agent)).toEqual(['a'])
      expect(queuedTexts(agent)).toEqual(['b'])
      expect(agent.status).toBe('idle')

      await update(b, { kind: 'run' })
      await agent.whenIdle()
      expect(sentTexts(agent)).toEqual(['a', 'b'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses to start an item while a turn or maintenance owns the agent', async () => {
    const { ctx, agent, update } = await harness(['hang'])
    try {
      const queued = message('queued')
      agent.followup(message('active'))
      agent.inbox.append('next-turn', queued)
      const running = await update(queued, { kind: 'run' })
      expect(running.ok ? null : running.error.code).toBe('session/agent-busy')
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      await agent.whenIdle()
      expect(queuedTexts(agent)).toEqual(['queued'])

      const maintenance = Promise.withResolvers<undefined>()
      const task = agent.runMaintenance(() => maintenance.promise)
      const busy = await update(queued, { kind: 'run' })
      expect(busy.ok ? null : busy.error).toMatchObject({ code: 'session/agent-busy' })
      maintenance.resolve(undefined)
      await task
      expect(queuedTexts(agent)).toEqual(['queued'])
      expect(agent.status).toBe('idle')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
