import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionSkillCatalog } from '../src/skill-catalog.ts'

function observation(
  sessionId: SessionId,
  options: { readonly cwd?: string; readonly agentPreset?: string } = {},
): SessionObservation {
  const events = Object.freeze([])
  const lease = (): SessionObservation => ({
    source: 'live',
    header: {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      isSeeded: false,
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
    },
    events,
    inheritedEventCount: SessionLogOffset(0),
    cursor: -1,
    projections: {
      asOfSeq: -1,
      values: {
        ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
      },
    },
    retain: lease,
    [Symbol.dispose]: () => {},
  })
  return lease()
}

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

describe('SessionSkillCatalog', () => {
  it('reads a cold Session catalog without resuming an Agent', async () => {
    const ctx = await context()
    const sessionId = SessionId('cold-skills')
    const observed = observation(sessionId, { cwd: '/cold/project' })
    const dispose = vi.spyOn(observed, Symbol.dispose)
    const observeSession = vi.fn(() => Promise.resolve(observed))
    ctx.provide('sessionQuery', { observeSession } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const list = vi.fn(() => Promise.resolve([
      {
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        path: '/cold/project/.agents/skills/review/SKILL.md',
        source: 'project-agents',
        invocation: { modelInvocable: true, userInvocable: true },
      },
      {
        name: 'model-only',
        description: 'Not shown to the user.',
        invocation: { modelInvocable: true, userInvocable: false },
      },
    ]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'review',
        description: 'Review the current change.',
        whenToUse: 'Before publishing.',
        path: '/cold/project/.agents/skills/review/SKILL.md',
        modelInvocable: true,
        kind: 'skill',
        subagent: false,
        source: 'project-agents',
        writable: false,
      }],
    })
    expect(observeSession).toHaveBeenCalledWith(sessionId)
    expect(dispose).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.list()).toEqual([])
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it('uses a live Agent to address a preset-owned registry', async () => {
    const ctx = await context()
    const sessionId = SessionId('live-skills')
    const session = ctx.sessions.create(sessionId, { meta: { cwd: '/live/project' } })
    const agent = { id: sessionId, session, status: 'idle', ctx } as Agent
    await ctx.agents.register(agent)
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/live/project' })),
    } as never)
    const scopedList = vi.fn(() => Promise.resolve([{
      name: 'preset-owned',
      description: 'Composed for this Agent.',
      source: 'runtime',
      invocation: { modelInvocable: false, userInvocable: true },
    }]))
    const acquireScope = vi.fn()
    ctx.provide('agentPresets', {
      serviceFor: () => ({ list: scopedList }),
      acquireScope,
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({
      skills: [{
        name: 'preset-owned',
        description: 'Composed for this Agent.',
        modelInvocable: false,
        kind: 'skill',
        subagent: false,
        source: 'runtime',
        writable: false,
      }],
    })
    expect(scopedList).toHaveBeenCalledWith({ cwd: '/live/project', scope: agent })
    expect(acquireScope).not.toHaveBeenCalled()
  })

  it('uses the recorded preset standing scope for a cold Session', async () => {
    const ctx = await context()
    const sessionId = SessionId('standing-skills')
    const scope = { agentPreset: 'minimal' }
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'minimal',
      })),
    } as never)
    const acquireScope = vi.fn(() => Promise.resolve({ key: scope, [Symbol.asyncDispose]: async () => {} }))
    ctx.provide('agentPresets', { acquireScope } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(acquireScope).toHaveBeenCalledWith('minimal')
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope })
    expect(ctx.agents.list()).toEqual([])
  })

  it('falls back to the global registry when the recorded preset is unavailable', async () => {
    const ctx = await context()
    const sessionId = SessionId('gone-preset')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, {
        cwd: '/cold/project',
        agentPreset: 'gone',
      })),
    } as never)
    ctx.provide('agentPresets', {
      acquireScope: () => Promise.reject(new Error('unknown preset')),
    } as never)
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('skills', { list } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal)).resolves.toEqual({ skills: [] })
    expect(list).toHaveBeenCalledWith({ cwd: '/cold/project', scope: undefined })
  })

  it.each([
    {
      error: new SessionQueryError(
        'session "missing-skills" not found',
        'SESSION_QUERY_SESSION_NOT_FOUND',
      ),
      code: 'session/not-found',
    },
    { error: new Error('storage offline'), code: 'gateway/internal' },
  ] as const)('classifies failed Session inspection as $code', async ({ error, code }) => {
    const ctx = await context()
    ctx.provide('sessionQuery', { observeSession: () => Promise.reject(error) } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list(
      { sessionId: SessionId('missing-skills') },
      new AbortController().signal,
    )).rejects.toMatchObject({ code })
  })

  it('reports an absent skill registry instead of an empty catalog', async () => {
    const ctx = await context()
    const sessionId = SessionId('no-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const failed = catalog.list({ sessionId }, new AbortController().signal)
    await expect(failed).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(failed).rejects.toThrow('skill registry is absent')
  })

  it('rejects observations without projections or a project cwd', async () => {
    const ctx = await context()
    const sessionId = SessionId('incomplete-skills')
    const withoutProjections = { ...observation(sessionId, { cwd: '/project' }), projections: undefined }
    const observeSession = vi.fn()
      .mockResolvedValueOnce(withoutProjections)
      .mockResolvedValueOnce(observation(sessionId))
    ctx.provide('sessionQuery', { observeSession } as never)
    const catalog = new SessionSkillCatalog(ctx)

    const unprojected = catalog.list({ sessionId }, new AbortController().signal)
    await expect(unprojected).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(unprojected).rejects.toThrow('projected Session observation')
    const cwdless = catalog.list({ sessionId }, new AbortController().signal)
    await expect(cwdless).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(cwdless).rejects.toThrow('has no project cwd')
  })

  it('classifies a provider listing failure', async () => {
    const ctx = await context()
    const sessionId = SessionId('failed-skills')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    ctx.provide('skills', {
      list: () => Promise.reject(new Error('catalog offline')),
    } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.list({ sessionId }, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'gateway/internal', message: 'skill listing failed: Error: catalog offline',
      })
  })

  it('maps kind, subagent, source, and writable', async () => {
    const root = await tempRoot('dsh-skill-list-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('mapped-skills')
    const flat = join(root, '.agents', 'skills', 'review-notes.md')
    const bundle = join(root, '.agents', 'skills', 'bundle', 'SKILL.md')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('review-notes', flat, { kind: 'rule', subagent: true }),
      summary('bundle', bundle, { source: 'bundled' }),
      {
        name: 'virtual',
        description: 'No file.',
        source: 'runtime',
        invocation: { modelInvocable: false, userInvocable: true },
      },
    ]))

    await expect(catalog.list({ sessionId }, signal())).resolves.toEqual({
      skills: [
        {
          name: 'review-notes',
          description: 'review-notes description',
          path: flat,
          modelInvocable: true,
          kind: 'rule',
          subagent: true,
          source: 'project-agents',
          writable: true,
        },
        {
          name: 'bundle',
          description: 'bundle description',
          path: bundle,
          modelInvocable: true,
          kind: 'skill',
          subagent: false,
          source: 'bundled',
          writable: false,
        },
        {
          name: 'virtual',
          description: 'No file.',
          modelInvocable: false,
          kind: 'skill',
          subagent: false,
          source: 'runtime',
          writable: false,
        },
      ],
    })
  })

  it('includes the markdown body of each writable skill', async () => {
    const root = await tempRoot('dsh-skill-body-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('body-skills')
    const flat = join(root, '.agents', 'skills', 'review-notes.md')
    const other = join(root, '.agents', 'skills', 'other-notes.md')
    const bundle = join(root, '.agents', 'skills', 'bundle', 'SKILL.md')
    const get = vi.fn((name: string) => Promise.resolve(
      name === 'review-notes' ? { content: 'Stay within limits.\n' } : undefined,
    ))
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('review-notes', flat, { kind: 'rule', subagent: true }),
      summary('other-notes', other),
      summary('bundle', bundle, { source: 'bundled' }),
    ]), undefined, get)

    const listed = await catalog.list({ sessionId }, signal())
    expect(listed.skills.map(skill => skill.name)).toEqual(['review-notes', 'other-notes', 'bundle'])
    expect(listed.skills[0]).toMatchObject({ writable: true, body: 'Stay within limits.\n' })
    expect(listed.skills[1]).not.toHaveProperty('body')
    expect(listed.skills[2]).not.toHaveProperty('body')
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledWith('review-notes', { cwd: root, scope: undefined })
  })

  it('lists a writable skill when its body cannot be read', async () => {
    const root = await tempRoot('dsh-skill-body-fail-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('body-fail')
    const flat = join(root, '.agents', 'skills', 'review-notes.md')
    const { catalog } = await mount(
      root,
      sessionId,
      () => Promise.resolve([summary('review-notes', flat)]),
      undefined,
      () => Promise.reject(new Error('unreadable')),
    )

    const listed = await catalog.list({ sessionId }, signal())
    expect(listed.skills[0]).toMatchObject({ name: 'review-notes', writable: true })
    expect(listed.skills[0]).not.toHaveProperty('body')
  })

  it('calls registry invalidate with the registry as its receiver', async () => {
    const root = await tempRoot('dsh-skill-invalidate-this-')
    const sessionId = SessionId('invalidate-this')
    const invalidate = vi.fn()
    const { catalog, skills } = await mount(root, sessionId, () => Promise.resolve([]), invalidate)

    await catalog.write(writeRequest(sessionId, 'review-notes'), signal())
    expect(invalidate.mock.contexts[0]).toBe(skills)
  })

  it('rejects skill names and paths outside the workspace', async () => {
    const root = await tempRoot('dsh-skill-confine-')
    const project = join(root, 'repo')
    const cwd = join(project, 'pkg')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(cwd, { recursive: true })
    const sessionId = SessionId('confined-skills')
    const { ctx, catalog } = await mount(cwd, sessionId, () => Promise.resolve([]))
    const write = vi.spyOn(ctx.fs, 'writeText')
    const aborted = signal()

    for (const name of ['..', 'Not-Kebab', 'notes.md', 'foo/../../etc/passwd']) {
      await expect(catalog.write(writeRequest(sessionId, name), aborted)).rejects.toMatchObject({
        code: 'gateway/bad-request',
      })
      await expect(catalog.delete({ sessionId, name }, aborted)).rejects.toMatchObject({
        code: 'gateway/bad-request',
      })
    }
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), aborted)).rejects.toThrow(
      'outside the session workspace',
    )
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, aborted)).rejects.toThrow(
      'outside the session workspace',
    )
    expect(write).not.toHaveBeenCalled()
    expect(existsSync(join(project, '.agents', 'skills', 'review-notes.md'))).toBe(false)
  })

  it('rejects a name owned by a higher-rank skill and creates no file', async () => {
    const root = await tempRoot('dsh-skill-shadow-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('shadowed-skill')
    const winning = join(root, '.dsh', 'skills', 'review-notes', 'SKILL.md')
    const shadow = join(root, '.agents', 'skills', 'review-notes.md')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('review-notes', winning, { source: 'project-dsh' }),
    ]))
    const write = vi.spyOn(ctx.fs, 'writeText')

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(winning)
    expect(write).not.toHaveBeenCalled()
    expect(existsSync(shadow)).toBe(false)

    await mkdir(join(root, '.agents', 'skills'), { recursive: true })
    await writeFile(shadow, 'shadow')
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toThrow(winning)
    expect(await readFile(shadow, 'utf8')).toBe('shadow')
  })

  it('writes a flat skill in the cwd when no git root exists', async () => {
    const root = await tempRoot('dsh-skill-nogit-')
    const sessionId = SessionId('nogit-skill')
    const file = join(root, '.agents', 'skills', 'review-notes.md')
    const listed: object[] = []
    const invalidate = vi.fn()
    const { catalog } = await mount(root, sessionId, () => Promise.resolve(listed), invalidate)
    const written = await catalog.write(writeRequest(sessionId, 'review-notes'), signal())

    expect(written).toEqual({ path: file })
    expect(await readFile(file, 'utf8')).toBe([
      '---',
      'name: review-notes',
      'description: Review notes.',
      'metadata:',
      '  kind: rule',
      '  subagent: true',
      '---',
      'Be careful.',
      '',
    ].join('\n'))
    expect(invalidate).toHaveBeenCalledOnce()

    listed.push(summary('review-notes', file, { kind: 'rule', subagent: true }))
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).resolves.toEqual({ path: file })
    expect(existsSync(file)).toBe(false)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('writes a renamed skill before the old file disappears', async () => {
    const root = await tempRoot('dsh-skill-rename-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('rename-skill')
    const oldFile = join(root, '.agents', 'skills', 'old-name.md')
    const newFile = join(root, '.agents', 'skills', 'new-name.md')
    await mkdir(dirname(oldFile), { recursive: true })
    await writeFile(oldFile, 'old')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('old-name', oldFile),
    ]))
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementation((...args) => {
      expect(existsSync(oldFile)).toBe(true)
      expect(existsSync(newFile)).toBe(false)
      return realWrite(...args)
    })

    await catalog.write(writeRequest(sessionId, 'new-name', { replaces: 'old-name' }), signal())
    expect(existsSync(newFile)).toBe(true)
    expect(existsSync(oldFile)).toBe(false)
    expect(await readFile(newFile, 'utf8')).toContain('name: new-name')
  })

  it('leaves the old skill in place when the new name already exists', async () => {
    const root = await tempRoot('dsh-skill-rename-exists-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('rename-exists')
    const oldFile = join(root, '.agents', 'skills', 'old-name.md')
    const newFile = join(root, '.agents', 'skills', 'new-name.md')
    await mkdir(dirname(oldFile), { recursive: true })
    await writeFile(oldFile, 'old')
    await writeFile(newFile, 'kept')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('old-name', oldFile),
    ]))

    await expect(catalog.write(
      writeRequest(sessionId, 'new-name', { replaces: 'old-name' }),
      signal(),
    )).rejects.toThrow(`skill "new-name" already exists at "${newFile}"`)
    expect(await readFile(oldFile, 'utf8')).toBe('old')
    expect(await readFile(newFile, 'utf8')).toBe('kept')
  })

  it('keeps the new skill when the old path cannot be removed', async () => {
    const root = await tempRoot('dsh-skill-unlink-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('unlink-skill')
    const oldFile = join(root, '.agents', 'skills', 'old-name.md')
    const newFile = join(root, '.agents', 'skills', 'new-name.md')
    await mkdir(dirname(oldFile), { recursive: true })
    await writeFile(oldFile, 'old')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('old-name', oldFile),
    ]))
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (...args) => {
      const written = await realWrite(...args)
      await rm(oldFile)
      await mkdir(oldFile)
      return written
    })

    await expect(catalog.write(
      writeRequest(sessionId, 'new-name', { replaces: 'old-name' }),
      signal(),
    )).rejects.toThrow('old file is still present')
    expect(existsSync(newFile)).toBe(true)
    expect(existsSync(oldFile)).toBe(true)
    expect(await readFile(newFile, 'utf8')).toContain('name: new-name')
  })

  it('does not unlink a skill file when the filesystem has no host path', async () => {
    const root = await tempRoot('dsh-skill-remote-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('remote-skill')
    const file = join(root, '.agents', 'skills', 'review-notes.md')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'stay')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('review-notes', file),
    ]))
    vi.spyOn(ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)

    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toThrow(
      'skill delete is unavailable',
    )
    expect(await readFile(file, 'utf8')).toBe('stay')
  })

  it('rejects a skill write when the filesystem is absent', async () => {
    const ctx = await context()
    const sessionId = SessionId('no-fs-skill')
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: '/project' })),
    } as never)
    ctx.provide('skills', { list: () => Promise.resolve([]) } as never)
    const catalog = new SessionSkillCatalog(ctx)

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(
      'filesystem is absent',
    )
  })
})

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

function signal(): AbortSignal {
  return new AbortController().signal
}

function summary(
  name: string,
  path: string,
  extra: { readonly kind?: 'rule' | 'skill'; readonly subagent?: boolean; readonly source?: string } = {},
) {
  return {
    name,
    description: `${name} description`,
    path,
    source: extra.source ?? 'project-agents',
    invocation: { modelInvocable: true, userInvocable: true },
    ...extra.kind === undefined ? {} : { kind: extra.kind },
    ...extra.subagent === undefined ? {} : { subagent: extra.subagent },
  }
}

function writeRequest(sessionId: SessionId, name: string, extra: { readonly replaces?: string } = {}) {
  return {
    sessionId,
    name,
    description: 'Review notes.',
    kind: 'rule' as const,
    subagent: true,
    body: 'Be careful.\n',
    ...extra.replaces === undefined ? {} : { replaces: extra.replaces },
  }
}

async function mount(
  cwd: string,
  sessionId: SessionId,
  list: () => Promise<readonly object[]>,
  invalidate?: (this: object) => void,
  get?: (
    name: string,
    options: { readonly cwd: string; readonly scope: object | undefined },
  ) => Promise<{ readonly content?: string } | undefined>,
) {
  const ctx = await context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd }).await()
  ctx.provide('sessionQuery', {
    observeSession: () => Promise.resolve(observation(sessionId, { cwd })),
  } as never)
  const skills = {
    list,
    ...invalidate === undefined ? {} : { invalidate },
    ...get === undefined ? {} : { get },
  }
  ctx.provide('skills', skills as never)
  return { ctx, catalog: new SessionSkillCatalog(ctx), skills }
}
