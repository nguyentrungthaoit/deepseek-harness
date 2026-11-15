/** The route address and the response validator the panel relies on. */
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { activityGitUrl, isRepository } from '../src/git.ts'

const commit = { hash: 'a'.repeat(40), parents: ['b'.repeat(40)], time: 5, subject: 's' }
const good = { branch: 'main', commits: [commit], files: 1, added: 2, deleted: 3 }

it('addresses the route with the Session and limit', () => {
  expect(activityGitUrl(SessionId('s 1'), 8)).toBe('api/activity.git?sessionId=s+1&limit=8')
})

it('accepts a well-formed repository and rejects malformed ones', () => {
  expect(isRepository(good)).toBe(true)
  expect(isRepository({ ...good, branch: null, commits: [] })).toBe(true)
  for (const bad of [
    null, [], 'x', { ...good, branch: 1 }, { ...good, files: -1 }, { ...good, added: 1.5 }, { ...good, commits: 'x' },
    { ...good, commits: [null] }, { ...good, commits: [{ ...commit, hash: '' }] }, { ...good, commits: [{ ...commit, subject: 1 }] },
    { ...good, commits: [{ ...commit, time: 'x' }] }, { ...good, commits: [{ ...commit, parents: [''] }] },
    { ...good, commits: [{ ...commit, parents: 'x' }] },
  ]) expect(isRepository(bad)).toBe(false)
})
