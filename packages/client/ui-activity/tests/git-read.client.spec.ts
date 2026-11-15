/** The browser read maps the route answers to a repository, a missing repository, or a failure. */
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { fetchRepository } from '../src/client/git-read.ts'

afterEach(() => { vi.unstubAllGlobals() })

const repository = { branch: 'main', commits: [], files: 0, added: 0, deleted: 0 }

function answer(response: Response) {
  const fetchStub = vi.fn(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

it('returns the repository the Host serves', async () => {
  const stub = answer(Response.json(repository))
  const signal = new AbortController().signal
  expect(await fetchRepository(SessionId('s1'), 8, signal)).toEqual(repository)
  expect(stub).toHaveBeenCalledWith('api/activity.git?sessionId=s1&limit=8', { signal })
})

it('reports a workspace outside git as null', async () => {
  answer(new Response('none', { status: 404 }))
  expect(await fetchRepository(SessionId('s1'), 8, new AbortController().signal)).toBeNull()
})

it('rejects a failed or malformed answer', async () => {
  answer(new Response('boom', { status: 500 }))
  await expect(fetchRepository(SessionId('s1'), 8, new AbortController().signal)).rejects.toThrow('status 500')
  answer(Response.json({ nope: true }))
  await expect(fetchRepository(SessionId('s1'), 8, new AbortController().signal)).rejects.toThrow('malformed')
})
