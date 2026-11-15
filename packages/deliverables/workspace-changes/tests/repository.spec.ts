/** The repository read serves recent commits, the checked-out branch, and uncommitted change counts without touching the repository. */
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as WorkspaceChanges from '../src/index.ts'
import { git, scratchDir } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

const signal = new AbortController().signal

async function boot(config: Partial<WorkspaceChanges.Config> = {}) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(WorkspaceChanges, config as WorkspaceChanges.Config)
  return ctx
}

async function init(prefix: string): Promise<string> {
  const cwd = await scratchDir(prefix, cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  return cwd
}

describe('workspaceChanges.repository', () => {
  it('lists commits newest first with merge parents and counts the uncommitted work', async () => {
    const cwd = await init('dsh-workspace-changes-log-')
    await writeFile(join(cwd, 'a.txt'), 'one\ntwo\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'first')
    git(cwd, 'checkout', '-q', '-b', 'side')
    await writeFile(join(cwd, 'b.txt'), 'b\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'side work')
    git(cwd, 'checkout', '-q', 'main')
    await writeFile(join(cwd, 'c.txt'), 'c\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'main work')
    git(cwd, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    await writeFile(join(cwd, 'a.txt'), 'one\nTWO\nthree\n')
    await writeFile(join(cwd, 'new.txt'), 'untracked\n')
    git(cwd, 'add', 'a.txt')
    const ctx = await boot()
    ctx.sessions.create(SessionId('log'), { meta: { cwd } })
    const repository = await ctx.workspaceChanges.repository(SessionId('log'), 3, signal)
    expect(repository).toMatchObject({ branch: 'main', files: 2, added: 2, deleted: 1 })
    expect(repository!.commits.map(commit => commit.subject)).toHaveLength(3)
    const [merge, ...older] = repository!.commits
    expect(merge).toMatchObject({ subject: 'merge side' })
    expect(merge!.parents).toHaveLength(2)
    expect(merge!.hash).toBe(git(cwd, 'rev-parse', 'HEAD').trim())
    expect(merge!.time).toBeGreaterThan(Date.now() - 60_000)
    expect(older.map(commit => commit.subject).sort()).toEqual(['main work', 'side work'])
    const all = await ctx.workspaceChanges.repository(SessionId('log'), 10, signal)
    expect(all!.commits.at(-1)).toMatchObject({ subject: 'first', parents: [] })
  })

  it('clamps the request to maxCommits and reports a detached HEAD without a branch', async () => {
    const cwd = await init('dsh-workspace-changes-detached-')
    for (const name of ['1', '2', '3']) {
      await writeFile(join(cwd, `${name}.txt`), name)
      git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', name)
    }
    git(cwd, 'checkout', '-q', '--detach')
    const ctx = await boot({ maxCommits: 2 })
    ctx.sessions.create(SessionId('detached'), { meta: { cwd } })
    const repository = await ctx.workspaceChanges.repository(SessionId('detached'), 99, signal)
    expect(repository).toMatchObject({ branch: null, files: 0, added: 0, deleted: 0 })
    expect(repository!.commits.map(commit => commit.subject)).toEqual(['3', '2'])
    expect((await ctx.workspaceChanges.repository(SessionId('detached'), 0, signal))!.commits).toHaveLength(1)
  })

  it('counts a repository without commits against the empty tree', async () => {
    const cwd = await init('dsh-workspace-changes-unborn-')
    await writeFile(join(cwd, 'staged.txt'), 'a\nb\n')
    git(cwd, 'add', 'staged.txt')
    await writeFile(join(cwd, 'loose.txt'), 'x\n')
    const ctx = await boot()
    ctx.sessions.create(SessionId('unborn'), { meta: { cwd } })
    expect(await ctx.workspaceChanges.repository(SessionId('unborn'), 8, signal)).toEqual({
      branch: 'main', commits: [], files: 2, added: 2, deleted: 0,
    })
  })

  it('answers undefined without a live eligible Session, a repository, or git', async () => {
    const plain = await scratchDir('dsh-workspace-changes-norepo-', cleanups)
    const cwd = await init('dsh-workspace-changes-skip-')
    const ctx = await boot()
    ctx.sessions.create(SessionId('plain'), { meta: { cwd: plain } })
    ctx.sessions.create(SessionId('nocwd'))
    ctx.sessions.create(SessionId('sub'), { meta: { cwd, origin: 'subagent' } })
    for (const id of ['plain', 'nocwd', 'sub', 'unknown']) {
      expect(await ctx.workspaceChanges.repository(SessionId(id), 8, signal)).toBeUndefined()
    }
    const bare = await boot()
    vi.spyOn(bare.subprocess, 'resolveExecutable').mockRejectedValue(new Error('git: not found'))
    bare.sessions.create(SessionId('nogit'), { meta: { cwd } })
    expect(await bare.workspaceChanges.repository(SessionId('nogit'), 8, signal)).toBeUndefined()
  })

  it('fails the read when git fails and rejects a non-positive maxCommits', async () => {
    const cwd = await init('dsh-workspace-changes-broken-')
    await writeFile(join(cwd, 'a.txt'), 'a\n')
    git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', 'a')
    const ctx = await boot()
    ctx.sessions.create(SessionId('broken'), { meta: { cwd } })
    await rm(join(cwd, '.git', 'index'))
    await writeFile(join(cwd, '.git', 'index'), 'not an index')
    await expect(ctx.workspaceChanges.repository(SessionId('broken'), 8, signal)).rejects.toThrow('git diff failed')
    const other = new Context()
    cleanups.push(() => other.fiber.dispose())
    await other.plugin(SessionStore)
    await other.plugin(LocalSubprocessRuntime)
    await expect(other.plugin(WorkspaceChanges, { maxCommits: 0 } as WorkspaceChanges.Config)).rejects.toThrow('positive integer maxCommits')
  })
})
