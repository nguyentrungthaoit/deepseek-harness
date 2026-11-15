/** The Host half serves the repository read for a Session over the authenticated fetch fence. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import type { WorkspaceRepository } from '@deepseek-ai/dsh-workspace-changes/types'
import { apply, inject } from '../src/index.ts'
import { ACTIVITY_GIT_PATH } from '../src/git.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

const repository: WorkspaceRepository = {
  branch: 'main', files: 1, added: 2, deleted: 0,
  commits: [{ hash: 'a'.repeat(40), parents: [], time: 1_000, subject: 'init' }],
}

async function fixture(read: (id: string, limit: number) => Promise<WorkspaceRepository | undefined>) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const spy = vi.fn(async (id: string, limit: number, _signal: AbortSignal) => read(id, limit))
  ctx.provide('workspaceChanges', { repository: spy } as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  await ctx.plugin({ inject, apply })
  const handler = connection.createSharedFetchHandler('/api')
  const get = (query: string) => handler.fetch(new Request(`http://localhost${ACTIVITY_GIT_PATH}${query}`))
  return { get, spy }
}

it('serves the repository of a Session and passes the requested limit', async () => {
  const { get, spy } = await fixture(() => Promise.resolve(repository))
  const response = await get('?sessionId=s1&limit=8')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(repository)
  expect(spy.mock.calls[0]?.slice(0, 2)).toEqual(['s1', 8])
})

it('refuses malformed coordinates, answers 404 without a repository, and 500 when git fails', async () => {
  let mode: 'none' | 'fail' = 'none'
  const { get, spy } = await fixture(() => mode === 'none' ? Promise.resolve(undefined) : Promise.reject(new Error('git failed')))
  for (const query of ['', '?sessionId=s1', '?limit=8', '?sessionId=s1&limit=x', '?sessionId=s1&limit=0']) {
    expect((await get(query)).status).toBe(400)
  }
  expect(spy).not.toHaveBeenCalled()
  expect((await get('?sessionId=s1&limit=8')).status).toBe(404)
  mode = 'fail'
  expect((await get('?sessionId=s1&limit=8')).status).toBe(500)
})
