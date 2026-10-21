import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import type * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type * as dshSkill from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionSkillCatalog } from '../src/skill-catalog.ts'

const unlinkFailure = vi.hoisted(() => ({ error: undefined as Error | undefined }))
const nameCheck = vi.hoisted(() => ({ acceptAll: false }))

vi.mock('@deepseek-ai/dsh-skill', async (importOriginal) => {
  const actual = await importOriginal<typeof dshSkill>()
  return {
    ...actual,
    isSkillName: (name: string) => nameCheck.acceptAll || actual.isSkillName(name),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return {
    ...actual,
    unlink: (path: string) => unlinkFailure.error === undefined
      ? actual.unlink(path)
      : Promise.reject(unlinkFailure.error),
  }
})

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

  it('maps subagent, source, and writable without a kind', async () => {
    const root = await tempRoot('dsh-skill-list-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('mapped-skills')
    const flat = join(root, '.agents', 'skills', 'review-notes.md')
    const bundle = join(root, '.agents', 'skills', 'bundle', 'SKILL.md')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([
      { ...summary('review-notes', flat, { subagent: true }), kind: 'rule' } as never,
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
          subagent: true,
          source: 'project-agents',
          writable: true,
        },
        {
          name: 'bundle',
          description: 'bundle description',
          path: bundle,
          modelInvocable: true,
          subagent: false,
          source: 'bundled',
          writable: false,
        },
        {
          name: 'virtual',
          description: 'No file.',
          modelInvocable: false,
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
      summary('review-notes', flat, { subagent: true }),
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
      '  subagent: true',
      '---',
      'Be careful.',
      '',
    ].join('\n'))
    expect(invalidate).toHaveBeenCalledOnce()

    listed.push(summary('review-notes', file, { subagent: true }))
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
    await writeFile(oldFile, skillText('old-name'))
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
    await writeFile(oldFile, skillText('old-name'))
    await writeFile(newFile, 'kept')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('old-name', oldFile),
    ]))

    await expect(catalog.write(
      writeRequest(sessionId, 'new-name', { replaces: 'old-name' }),
      signal(),
    )).rejects.toThrow(`skill "new-name" already exists at "${newFile}"`)
    expect(await readFile(oldFile, 'utf8')).toBe(skillText('old-name'))
    expect(await readFile(newFile, 'utf8')).toBe('kept')
  })

  it('keeps the new skill when the old path cannot be removed', async () => {
    const root = await tempRoot('dsh-skill-unlink-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('unlink-skill')
    const oldFile = join(root, '.agents', 'skills', 'old-name.md')
    const newFile = join(root, '.agents', 'skills', 'new-name.md')
    await mkdir(dirname(oldFile), { recursive: true })
    await writeFile(oldFile, skillText('old-name'))
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

const RICH_SKILL = [
  '---',
  '# Owned by the docs team.',
  'name: review-notes',
  'description: Old description.',
  'disable-model-invocation: true',
  'whenToUse: Before publishing a long change that touches many packages and needs a careful review pass. # routing',
  'metadata:',
  '  owner: docs # keep this owner',
  '  kind: rule',
  '  subagent: false',
  'x-extra: [a, b]',
  '---',
  'Old body.',
  '',
].join('\n')

describe('SessionSkillCatalog file edits', () => {
  it.each([
    { label: 'body', name: 'review-notes', patch: { body: 'New body.\n' }, body: 'New body.\n' },
    { label: 'description', name: 'review-notes', patch: { description: 'New description.' }, body: 'Old body.\n' },
    { label: 'subagent', name: 'review-notes', patch: { subagent: true }, body: 'Old body.\n' },
    { label: 'rename', name: 'renamed-notes', patch: { replaces: 'review-notes' }, body: 'Old body.\n' },
  ])('keeps unrelated frontmatter and comments when editing $label', async ({ name, patch, body }) => {
    const { root, catalog, sessionId, file } = await mountExisting('dsh-skill-keep-', RICH_SKILL)
    const request = {
      sessionId,
      name,
      description: 'Old description.',
      subagent: false,
      ...patch,
    }

    await catalog.write(request, signal())
    const written = await readFile(join(root, '.agents', 'skills', `${name}.md`), 'utf8')
    const { data, yaml, rest } = frontmatterOf(written)
    expect(data).toEqual({
      name,
      description: request.description,
      'disable-model-invocation': true,
      whenToUse: 'Before publishing a long change that touches many packages and needs a careful review pass.',
      metadata: { owner: 'docs', kind: 'rule', subagent: request.subagent },
      'x-extra': ['a', 'b'],
    })
    expect(Object.keys(data)).toEqual([
      'name', 'description', 'disable-model-invocation', 'whenToUse', 'metadata', 'x-extra',
    ])
    expect(yaml).toContain('# Owned by the docs team.')
    expect(yaml).toContain('# routing')
    expect(yaml).toContain('# keep this owner')
    expect(rest).toBe(body)
    expect(existsSync(file)).toBe(name === 'review-notes')
  })

  it.each([
    { label: 'absent', source: '---\nname: review-notes\ndescription: Old.\n---\nOld body.\n' },
    { label: 'null', source: '---\nname: review-notes\ndescription: Old.\nmetadata:\n---\nOld body.\n' },
  ])('adds metadata when the existing value is $label', async ({ source }) => {
    const { catalog, sessionId, file } = await mountExisting('dsh-skill-metadata-', source)

    await catalog.write(bodyless(writeRequest(sessionId, 'review-notes')), signal())
    const { data, rest } = frontmatterOf(await readFile(file, 'utf8'))
    expect(data).toEqual(expect.objectContaining({ metadata: { subagent: true } }))
    expect(rest).toBe('Old body.\n')
  })

  it('keeps an empty body when the closing line ends the file', async () => {
    const { catalog, sessionId, file } = await mountExisting(
      'dsh-skill-eof-',
      '---\r\nname: review-notes\ndescription: Old.\n---',
    )

    await catalog.write(bodyless(writeRequest(sessionId, 'review-notes')), signal())
    expect(frontmatterOf(await readFile(file, 'utf8')).rest).toBe('')
  })

  it('ignores a legacy kind field on a write request and writes no metadata.kind', async () => {
    const root = await tempRoot('dsh-skill-legacy-kind-')
    const sessionId = SessionId('legacy-kind')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([]))

    const { path } = await catalog.write({ ...writeRequest(sessionId, 'review-notes'), kind: 'other' } as never, signal())
    expect(frontmatterOf(await readFile(path, 'utf8')).data).toMatchObject({ metadata: { subagent: true } })
    expect(await readFile(path, 'utf8')).not.toContain('kind')
  })

  it('creates an empty body when a new skill has no body', async () => {
    const root = await tempRoot('dsh-skill-create-empty-')
    const sessionId = SessionId('create-empty')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([]))

    const { path } = await catalog.write(bodyless(writeRequest(sessionId, 'review-notes')), signal())
    expect(await readFile(path, 'utf8')).toMatch(/\n---\n$/)
  })

  it.each([
    { label: 'no newline', source: '---' },
    { label: 'no opening line', source: 'name: review-notes\n' },
    { label: 'no closing line', source: '---\nname: review-notes\n' },
    { label: 'invalid YAML', source: '---\nname: [review-notes\n---\nbody\n' },
    { label: 'a list', source: '---\n- review-notes\n---\nbody\n' },
    { label: 'scalar metadata', source: '---\nname: review-notes\nmetadata: 3\n---\nbody\n' },
  ])('rejects an existing file with $label and leaves it unchanged', async ({ source }) => {
    const { ctx, catalog, sessionId, file } = await mountExisting('dsh-skill-malformed-', source)
    const write = vi.spyOn(ctx.fs, 'writeText')

    const failed = catalog.write(writeRequest(sessionId, 'review-notes'), signal())
    await expect(failed).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(failed).rejects.toThrow(`skill file "${file}" has malformed frontmatter`)
    expect(write).not.toHaveBeenCalled()
    expect(await readFile(file, 'utf8')).toBe(source)
  })

  it('rejects a rename whose source frontmatter is malformed', async () => {
    const { ctx, root, catalog, sessionId, file } = await mountExisting('dsh-skill-malformed-rename-', 'broken\n')
    const write = vi.spyOn(ctx.fs, 'writeText')

    await expect(catalog.write(
      writeRequest(sessionId, 'renamed-notes', { replaces: 'review-notes' }),
      signal(),
    )).rejects.toThrow(`skill file "${file}" has malformed frontmatter`)
    expect(write).not.toHaveBeenCalled()
    expect(existsSync(join(root, '.agents', 'skills', 'renamed-notes.md'))).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('broken\n')
  })

  it('lists a version for writable rows only', async () => {
    const root = await tempRoot('dsh-skill-version-list-')
    await mkdir(join(root, '.git'))
    const sessionId = SessionId('version-list')
    const flat = join(root, '.agents', 'skills', 'review-notes.md')
    const missing = join(root, '.agents', 'skills', 'missing-notes.md')
    const bundle = join(root, '.agents', 'skills', 'bundle', 'SKILL.md')
    await mkdir(dirname(bundle), { recursive: true })
    await writeFile(flat, skillText('review-notes'))
    await writeFile(bundle, skillText('bundle'))
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([
      summary('review-notes', flat),
      summary('missing-notes', missing),
      summary('bundle', bundle, { source: 'bundled' }),
    ]))
    const target = await ctx.fs.resolve(flat)

    const listed = await catalog.list({ sessionId }, signal())
    expect(listed.skills[0]).toMatchObject({ writable: true, version: (await ctx.fs.stat(target))?.version })
    expect(listed.skills[1]).toMatchObject({ writable: true })
    expect(listed.skills[1]).not.toHaveProperty('version')
    expect(listed.skills[2]).toMatchObject({ writable: false })
    expect(listed.skills[2]).not.toHaveProperty('version')

    vi.spyOn(ctx.fs, 'stat').mockRejectedValue(new Error('stat offline'))
    expect((await catalog.list({ sessionId }, signal())).skills[0]).not.toHaveProperty('version')
  })

  it('lists no version when the filesystem is absent', async () => {
    const root = await tempRoot('dsh-skill-version-nofs-')
    const sessionId = SessionId('version-nofs')
    const ctx = await context()
    contexts.push(ctx)
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd: root })),
    } as never)
    ctx.provide('skills', {
      list: () => Promise.resolve([summary('review-notes', join(root, '.agents', 'skills', 'review-notes.md'))]),
    } as never)

    const listed = await new SessionSkillCatalog(ctx).list({ sessionId }, signal())
    expect(listed.skills[0]).toMatchObject({ writable: true })
    expect(listed.skills[0]).not.toHaveProperty('version')
  })

  it('accepts writes and deletes whose expected version is current', async () => {
    const { ctx, root, catalog, sessionId, file } = await mountExisting('dsh-skill-version-ok-', skillText('review-notes'))
    const version = async (path: string) => (await ctx.fs.stat(await ctx.fs.resolve(path)))!.version

    await catalog.write({ ...writeRequest(sessionId, 'review-notes'), expectedVersion: await version(file) }, signal())
    const renamed = join(root, '.agents', 'skills', 'renamed-notes.md')
    await catalog.write({
      ...writeRequest(sessionId, 'renamed-notes', { replaces: 'review-notes' }),
      expectedVersion: await version(file),
    }, signal())
    expect(existsSync(file)).toBe(false)
    expect(frontmatterOf(await readFile(renamed, 'utf8')).data).toMatchObject({ name: 'renamed-notes' })
  })

  it('deletes a skill whose expected version is current', async () => {
    const { ctx, catalog, sessionId, file } = await mountExisting('dsh-skill-delete-ok-', skillText('review-notes'))
    const expectedVersion = (await ctx.fs.stat(await ctx.fs.resolve(file)))!.version

    await catalog.delete({ sessionId, name: 'review-notes', expectedVersion }, signal())
    expect(existsSync(file)).toBe(false)
  })

  it.each([
    { label: 'edit', run: (catalog: SessionSkillCatalog, sessionId: SessionId, expectedVersion: FsVersion) => catalog.write(
      { ...writeRequest(sessionId, 'review-notes'), expectedVersion },
      signal(),
    ) },
    { label: 'rename', run: (catalog: SessionSkillCatalog, sessionId: SessionId, expectedVersion: FsVersion) => catalog.write(
      { ...writeRequest(sessionId, 'renamed-notes', { replaces: 'review-notes' }), expectedVersion },
      signal(),
    ) },
    { label: 'delete', run: (catalog: SessionSkillCatalog, sessionId: SessionId, expectedVersion: FsVersion) => catalog.delete(
      { sessionId, name: 'review-notes', expectedVersion },
      signal(),
    ) },
  ])('rejects a stale expected version on $label and leaves the file', async ({ run }) => {
    const { ctx, root, catalog, sessionId, file } = await mountExisting('dsh-skill-stale-', skillText('review-notes'))
    const stale = (await ctx.fs.stat(await ctx.fs.resolve(file)))!.version
    const external = `${skillText('review-notes')}Edited outside the panel.\n`
    await writeFile(file, external)

    await expect(run(catalog, sessionId, stale)).rejects.toMatchObject({
      code: 'skills/conflict',
      details: { name: 'review-notes' },
    })
    expect(await readFile(file, 'utf8')).toBe(external)
    expect(existsSync(join(root, '.agents', 'skills', 'renamed-notes.md'))).toBe(false)
  })

  it('rejects an expected version for a file that no longer exists', async () => {
    const root = await tempRoot('dsh-skill-stale-gone-')
    const sessionId = SessionId('stale-gone')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([]))

    await expect(catalog.write(
      { ...writeRequest(sessionId, 'review-notes'), expectedVersion: FsVersion('gone') },
      signal(),
    )).rejects.toMatchObject({ code: 'skills/conflict', details: { name: 'review-notes' } })
    expect(existsSync(join(root, '.agents', 'skills', 'review-notes.md'))).toBe(false)
  })

  it('rejects a create when another writer creates the same name first', async () => {
    const root = await tempRoot('dsh-skill-create-race-')
    const sessionId = SessionId('create-race')
    const file = join(root, '.agents', 'skills', 'review-notes.md')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (...args) => {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, 'other writer')
      return await realWrite(...args)
    })

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({
      code: 'skills/conflict',
      details: { name: 'review-notes' },
    })
    expect(await readFile(file, 'utf8')).toBe('other writer')
  })

  it('rejects an edit when the file changes after it was read', async () => {
    const { ctx, catalog, sessionId, file } = await mountExisting('dsh-skill-edit-race-', skillText('review-notes'))
    const realWrite = ctx.fs.writeText.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (...args) => {
      await writeFile(file, 'other writer, longer content')
      return await realWrite(...args)
    })

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({
      code: 'skills/conflict',
    })
    expect(await readFile(file, 'utf8')).toBe('other writer, longer content')
  })

  it('rejects a rename whose listed source is missing or not a file', async () => {
    const { root, catalog, sessionId, file } = await mountExisting('dsh-skill-source-kind-', skillText('review-notes'))
    await rm(file)
    const request = writeRequest(sessionId, 'renamed-notes', { replaces: 'review-notes' })

    await expect(catalog.write(request, signal())).rejects.toMatchObject({
      code: 'skills/conflict',
      details: { name: 'review-notes' },
    })
    await mkdir(file)
    await expect(catalog.write(request, signal())).rejects.toMatchObject({
      code: 'gateway/bad-request',
      message: `skill path "${file}" is not a regular file`,
    })
    expect(existsSync(join(root, '.agents', 'skills', 'renamed-notes.md'))).toBe(false)
  })

  it('classifies a failed or aborted source read', async () => {
    const { ctx, catalog, sessionId, file } = await mountExisting('dsh-skill-read-fail-', skillText('review-notes'))
    const readText = vi.spyOn(ctx.fs, 'readText').mockRejectedValueOnce(new Error('disk offline'))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({
      code: 'gateway/internal',
      message: `skill file "${file}" could not be read: Error: disk offline`,
    })
    const controller = new AbortController()
    readText.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), controller.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
  })
})

describe('SessionSkillCatalog request and filesystem failures', () => {
  it.each([
    { label: 'description', patch: { description: 5 }, message: 'skill description must be a string' },
    { label: 'body', patch: { body: 5 }, message: 'skill body must be a string' },
    { label: 'subagent', patch: { subagent: 'yes' }, message: 'skill subagent must be a boolean' },
  ])('rejects a non-conforming $label', async ({ patch, message }) => {
    const sessionId = SessionId('bad-request-skill')
    const catalog = new SessionSkillCatalog(await context())

    await expect(catalog.write({ ...writeRequest(sessionId, 'review-notes'), ...patch } as never, signal()))
      .rejects.toMatchObject({ code: 'gateway/bad-request', message })
  })

  it('rejects a name that escapes the skill directory even when it passes the name check', async () => {
    const root = await tempRoot('dsh-skill-escape-')
    const sessionId = SessionId('escape-skill')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const write = vi.spyOn(ctx.fs, 'writeText')
    nameCheck.acceptAll = true
    try {
      await expect(catalog.write(writeRequest(sessionId, '../escape'), signal())).rejects.toThrow(
        `must stay inside ${join(root, '.agents', 'skills')}`,
      )
    } finally {
      nameCheck.acceptAll = false
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects a create over a directory', async () => {
    const root = await tempRoot('dsh-skill-dir-target-')
    const sessionId = SessionId('dir-target')
    const file = join(root, '.agents', 'skills', 'review-notes.md')
    await mkdir(file, { recursive: true })
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([]))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(
      `skill path "${file}" is not a regular file`,
    )
  })

  it('writes subagent false and quotes a description that needs it', async () => {
    const root = await tempRoot('dsh-skill-quoted-')
    const sessionId = SessionId('quoted-skill')
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const description = 'Review: "notes"\\path\r\nnext'

    const { path } = await catalog.write({ ...writeRequest(sessionId, 'review-notes'), description, subagent: false }, signal())
    expect(frontmatterOf(await readFile(path, 'utf8')).data).toMatchObject({
      description,
      metadata: { subagent: false },
    })
  })

  it.each([
    { label: 'an Error', error: new Error('catalog offline'), code: 'gateway/internal', message: 'skill listing failed: Error: catalog offline' },
    {
      label: 'a RemoteError',
      error: new RemoteError('session/agent-busy', 'busy', { reason: 'busy' }),
      code: 'session/agent-busy',
      message: 'busy',
    },
  ])('classifies a write-time listing failure from $label', async ({ error, code, message }) => {
    const root = await tempRoot('dsh-skill-list-fail-')
    const sessionId = SessionId('list-fail')
    const { catalog } = await mount(root, sessionId, () => Promise.reject(error))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({ code, message })
  })

  it('names owners without a file path', async () => {
    const root = await tempRoot('dsh-skill-pathless-')
    const sessionId = SessionId('pathless-skill')
    const runtime = {
      name: 'review-notes',
      description: 'Runtime.',
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true },
    }
    const { catalog } = await mount(root, sessionId, () => Promise.resolve([runtime, summary('old-name', 'x')]))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(
      'skill "review-notes" is owned by a skill with no file path',
    )
    await expect(catalog.write(writeRequest(sessionId, 'review-notes', { replaces: 'old-name' }), signal()))
      .rejects.toThrow('skill "review-notes" is owned by a skill with no file path')
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toThrow(
      'skill "review-notes" is not a writable flat project skill',
    )
  })

  it('classifies a failed or aborted path inspection', async () => {
    const root = await tempRoot('dsh-skill-lstat-fail-')
    const sessionId = SessionId('lstat-fail')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const lstat = vi.spyOn(ctx.fs, 'lstat').mockRejectedValueOnce(new Error('lstat offline'))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'skill path could not be inspected: Error: lstat offline',
    })
    const controller = new AbortController()
    lstat.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), controller.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
  })

  it('rejects a write whose resolved path leaves the workspace or the skill directory', async () => {
    const root = await tempRoot('dsh-skill-resolved-')
    const sessionId = SessionId('resolved-skill')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const processPath = vi.spyOn(ctx.fs, 'processPath')

    processPath.mockReturnValueOnce(join(dirname(root), 'elsewhere.md'))
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(
      'is outside the session workspace',
    )
    processPath.mockReturnValueOnce(join(root, 'elsewhere.md'))
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toThrow(
      `is outside ${join(root, '.agents', 'skills')}`,
    )
  })

  it('classifies a failed or aborted file write', async () => {
    const root = await tempRoot('dsh-skill-write-fail-')
    const sessionId = SessionId('write-fail')
    const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([]))
    const writeText = vi.spyOn(ctx.fs, 'writeText').mockRejectedValueOnce(new Error('disk full'))

    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), signal())).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'skill write failed: Error: disk full',
    })
    const controller = new AbortController()
    writeText.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(catalog.write(writeRequest(sessionId, 'review-notes'), controller.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
  })

  it('classifies a failed or aborted delete resolution', async () => {
    const { ctx, catalog, sessionId, file } = await mountExisting('dsh-skill-delete-resolve-', skillText('review-notes'))
    const realResolve = ctx.fs.resolve.bind(ctx.fs)
    const controller = new AbortController()
    let abort = false
    vi.spyOn(ctx.fs, 'resolve').mockImplementation((path, options) => {
      if (path !== file) return realResolve(path, options)
      if (abort) controller.abort()
      return Promise.reject(new Error('resolve offline'))
    })

    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'skill delete is unavailable: Error: resolve offline',
    })
    abort = true
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, controller.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
    expect(existsSync(file)).toBe(true)
  })

  it('classifies a delete whose file is missing, a directory, or not unlinkable', async () => {
    const { catalog, sessionId, file } = await mountExisting('dsh-skill-delete-kind-', skillText('review-notes'))

    unlinkFailure.error = new Error('unlink denied')
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'skill file could not be deleted: Error: unlink denied',
    })
    unlinkFailure.error = undefined
    expect(existsSync(file)).toBe(true)
    await rm(file)
    const missing = catalog.delete({ sessionId, name: 'review-notes' }, signal())
    await expect(missing).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(missing).rejects.toThrow('skill file could not be deleted')
    await mkdir(file)
    await expect(catalog.delete({ sessionId, name: 'review-notes' }, signal())).rejects.toMatchObject({
      code: 'gateway/bad-request',
      message: `skill path "${file}" is not a regular file`,
    })
  })

  it('walks past unresolvable git-root candidates', async () => {
    const { ctx, catalog, sessionId, root } = await mountExisting('dsh-skill-root-resolve-', skillText('review-notes'))
    const realResolve = ctx.fs.resolve.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'resolve').mockImplementation((path, options) => path.endsWith('.git')
      ? Promise.reject(new Error('hidden'))
      : realResolve(path, options))

    const listed = await catalog.list({ sessionId }, signal())
    expect(listed.skills[0]).toMatchObject({ path: join(root, '.agents', 'skills', 'review-notes.md'), writable: true })
  })

  it('finds a git root through host paths when the filesystem is absent', async () => {
    const root = await tempRoot('dsh-skill-host-root-')
    const cwd = join(root, 'pkg')
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(cwd, { recursive: true })
    const sessionId = SessionId('host-root')
    const ctx = await context()
    contexts.push(ctx)
    ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve(observation(sessionId, { cwd })),
    } as never)
    ctx.provide('skills', {
      list: () => Promise.resolve([summary('review-notes', join(root, '.agents', 'skills', 'review-notes.md'))]),
    } as never)

    const listed = await new SessionSkillCatalog(ctx).list({ sessionId }, signal())
    expect(listed.skills[0]).toMatchObject({ writable: false })
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
  extra: { readonly subagent?: boolean; readonly source?: string } = {},
) {
  return {
    name,
    description: `${name} description`,
    path,
    source: extra.source ?? 'project-agents',
    invocation: { modelInvocable: true, userInvocable: true },
    ...extra.subagent === undefined ? {} : { subagent: extra.subagent },
  }
}

function writeRequest(sessionId: SessionId, name: string, extra: { readonly replaces?: string } = {}) {
  return {
    sessionId,
    name,
    description: 'Review notes.',
    subagent: true,
    body: 'Be careful.\n',
    ...extra.replaces === undefined ? {} : { replaces: extra.replaces },
  }
}

function bodyless<T extends { readonly body: string }>(request: T): Omit<T, 'body'> {
  const { body, ...rest } = request
  void body
  return rest
}

function skillText(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\nBody.\n`
}

function frontmatterOf(text: string): { data: Record<string, unknown>; yaml: string; rest: string } {
  const match = /^---\r?\n([\s\S]*?)---(?:\n|$)([\s\S]*)$/.exec(text)
  if (match === null) throw new Error(`no frontmatter in ${text}`)
  const [, yaml = '', rest = ''] = match
  return { data: parseYaml(yaml) as Record<string, unknown>, yaml, rest }
}

/** Mount a git-rooted workspace with one listed flat `review-notes` file holding `source`. */
async function mountExisting(prefix: string, source: string) {
  const root = await tempRoot(prefix)
  await mkdir(join(root, '.git'))
  const sessionId = SessionId('existing-skill')
  const file = join(root, '.agents', 'skills', 'review-notes.md')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, source)
  const { ctx, catalog } = await mount(root, sessionId, () => Promise.resolve([summary('review-notes', file)]))
  return { ctx, root, catalog, sessionId, file }
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
