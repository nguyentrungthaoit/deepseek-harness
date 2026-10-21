/** Session skill catalog: grouping, list rows, versioned write and delete, conflicts, views, and session cleanup. */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult, SessionId, SkillEntry, SkillFileVersion } from '@deepseek-ai/dsh-api-remotes/client'
import { groupSkills, isKebabName, SkillCatalog, toManagedSkill } from '../src/client/catalog.ts'
import type { ManagedSkill } from '../src/client/catalog.ts'

const sid = 'session-1' as SessionId
const other = 'session-2' as SessionId
const v1 = 'v1' as SkillFileVersion
const v2 = 'v2' as SkillFileVersion

type Listed = RemoteResult<{ readonly skills: readonly SkillEntry[] }>
type Written = RemoteResult<{ readonly path: string }>

function entry(extra: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name: 'field-list',
    description: 'List the fields.',
    modelInvocable: true,
    subagent: false,
    source: '',
    writable: false,
    ...extra,
  }
}

function ok(skills: readonly SkillEntry[] = []): Listed {
  return { ok: true, value: { skills } }
}

function remote(overrides: {
  list?: () => Promise<Listed>
  write?: () => Promise<Written>
  delete?: () => Promise<Written>
} = {}) {
  const accepted = async (): Promise<Written> => ({ ok: true, value: { path: '/p' } })
  return {
    list: vi.fn(overrides.list ?? (async () => ok())),
    write: vi.fn(overrides.write ?? accepted),
    delete: vi.fn(overrides.delete ?? accepted),
  }
}

async function conflict(): Promise<Written> {
  return { ok: false, error: new RemoteError('skills/conflict', 'stale', { name: 'field-list' }) }
}

describe('skill catalog helpers', () => {
  it('accepts a kebab-case name and groups rows by writable, each by name', () => {
    expect(isKebabName('field-list')).toBe(true)
    expect(isKebabName('Field-List')).toBe(false)
    const row = (name: string, writable: boolean): ManagedSkill => ({
      name, description: name, modelInvocable: true, subagent: false, source: '', writable,
    })
    const groups = groupSkills([row('zeta', true), row('bundled', false), row('alpha', true)])
    expect(groups.editable.map(skill => skill.name)).toEqual(['alpha', 'zeta'])
    expect(groups.readonly.map(skill => skill.name)).toEqual(['bundled'])
    expect(groupSkills([])).toEqual({ editable: [], readonly: [] })
  })

  it('reads optional list fields, including body and version', () => {
    const bare = toManagedSkill(entry({ path: '/skills/field-list.md', whenToUse: 'schemas' }))
    expect(bare).toMatchObject({
      subagent: false, source: '', writable: false, path: '/skills/field-list.md', whenToUse: 'schemas',
    })
    expect(bare.body).toBeUndefined()
    expect(bare.version).toBeUndefined()
    const rule = toManagedSkill(entry({
      name: 'vertex-schema-limits', subagent: true, source: 'project', writable: true, body: 'Stay.', version: v1,
    }))
    expect(rule).toMatchObject({
      subagent: true, source: 'project', writable: true, body: 'Stay.', version: v1,
    })
  })
})

describe('SkillCatalog', () => {
  it('lists on first open, keeps rows on a failed refresh, and ignores a stale list', async () => {
    const pending: Array<(value: Listed) => void> = []
    const list = vi.fn(() => new Promise<Listed>((resolve) => { pending.push(resolve) }))
    const catalog = new SkillCatalog(remote({ list }), () => true)
    const store = catalog.source(sid).catalog
    expect(store.getSnapshot().status).toBe('loading')
    const fresh = catalog.reload(sid)
    pending[0]?.(ok([entry({ name: 'stale', source: 'old' })]))
    pending[1]?.(ok([entry({ source: 'project', writable: true, body: 'Body.', version: v1 })]))
    await fresh
    expect(store.getSnapshot().skills.map(row => row.name)).toEqual(['field-list'])
    expect(store.getSnapshot().skills[0]).toMatchObject({ body: 'Body.', version: v1 })
    list.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'denied', {}) })
    await catalog.reload(sid)
    expect(store.getSnapshot()).toMatchObject({ status: 'error', message: 'denied' })
    expect(store.getSnapshot().skills.map(row => row.name)).toEqual(['field-list'])
  })

  it('reports a thrown list failure and a non-Error rejection', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce('boom')
    const catalog = new SkillCatalog(remote({ list }), () => true)
    const store = catalog.source(sid).catalog
    await vi.waitFor(() => { expect(store.getSnapshot()).toMatchObject({ status: 'error', message: 'offline' }) })
    await catalog.reload(sid)
    expect(store.getSnapshot().message).toBe('boom')
  })

  it('sends the version, omits an absent body, and reloads after write and delete', async () => {
    const api = remote()
    const catalog = new SkillCatalog(api, () => true)
    catalog.source(sid)
    await vi.waitFor(() => { expect(api.list).toHaveBeenCalledTimes(1) })
    const toggled = await catalog.write(sid, {
      name: 'field-list', description: 'List.', subagent: true, expectedVersion: v1,
    })
    expect(toggled).toBeUndefined()
    expect(api.write).toHaveBeenLastCalledWith({
      sessionId: sid, name: 'field-list', description: 'List.', subagent: true, expectedVersion: v1,
    })
    expect(await catalog.write(sid, {
      name: 'plan-from-pdf', description: 'Plan.', subagent: false, body: 'Plan.', replaces: 'field-list',
    })).toBeUndefined()
    expect(api.write).toHaveBeenLastCalledWith({
      sessionId: sid, name: 'plan-from-pdf', description: 'Plan.', subagent: false, body: 'Plan.', replaces: 'field-list',
    })
    expect(await catalog.remove(sid, 'plan-from-pdf', v2)).toBeUndefined()
    expect(api.delete).toHaveBeenLastCalledWith({ sessionId: sid, name: 'plan-from-pdf', expectedVersion: v2 })
    expect(await catalog.remove(sid, 'field-list')).toBeUndefined()
    expect(api.delete).toHaveBeenLastCalledWith({ sessionId: sid, name: 'field-list' })
    expect(api.list).toHaveBeenCalledTimes(5)
  })

  it('returns the host message or a thrown value without reloading', async () => {
    const write = vi.fn<() => Promise<Written>>()
      .mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'locked', {}) })
      .mockRejectedValueOnce(new Error('disk'))
      .mockRejectedValueOnce(7)
    const api = remote({ write })
    const catalog = new SkillCatalog(api, () => true)
    const draft = { name: 'field-list', description: 'List.', subagent: false, body: '' }
    expect(await catalog.write(sid, draft)).toEqual({ message: 'locked', conflict: false })
    expect(await catalog.write(sid, draft)).toEqual({ message: 'disk', conflict: false })
    expect(await catalog.write(sid, draft)).toEqual({ message: '7', conflict: false })
    expect(api.list).not.toHaveBeenCalled()
  })

  it('flags skills/conflict from write and delete and lists again', async () => {
    const api = remote({ write: conflict, delete: conflict })
    const catalog = new SkillCatalog(api, () => true)
    const draft = { name: 'field-list', description: 'List.', subagent: false, expectedVersion: v1 }
    expect(await catalog.write(sid, draft)).toEqual({ message: 'stale', conflict: true })
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(await catalog.remove(sid, 'field-list', v1)).toEqual({ message: 'stale', conflict: true })
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('keeps one view per session and leaves a detail page whose skill is no longer listed', async () => {
    const list = vi.fn<() => Promise<Listed>>().mockResolvedValue(ok([entry()]))
    const bound = new Set<string>([sid, other])
    const catalog = new SkillCatalog(remote({ list }), id => bound.has(id))
    const mine = catalog.source(sid)
    const theirs = catalog.source(other)
    await vi.waitFor(() => { expect(mine.catalog.getSnapshot().status).toBe('ready') })
    expect(mine.view.getSnapshot()).toEqual({ kind: 'list' })
    mine.view.set({ kind: 'detail', name: 'field-list' })
    theirs.view.set({ kind: 'edit', name: 'gone' })
    expect(catalog.source(sid).view).toBe(mine.view)
    list.mockResolvedValue(ok([]))
    await catalog.reload(sid)
    expect(mine.view.getSnapshot()).toEqual({ kind: 'list' })
    await catalog.reload(other)
    expect(theirs.view.getSnapshot()).toEqual({ kind: 'edit', name: 'gone' })
    mine.view.set({ kind: 'detail', name: 'field-list' })
    list.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
    await catalog.reload(sid)
    expect(mine.view.getSnapshot()).toEqual({ kind: 'detail', name: 'field-list' })
    bound.delete(other)
    catalog.source(sid)
    expect(catalog.source(other).view).not.toBe(theirs.view)
  })

  it('forgets sessions whose binding is gone on the next source call and on dispose', async () => {
    const bound = new Set<string>([sid, other])
    const pending: Array<(value: Listed) => void> = []
    const list = vi.fn(() => new Promise<Listed>((resolve) => { pending.push(resolve) }))
    const catalog = new SkillCatalog(remote({ list }), id => bound.has(id))
    const first = catalog.source(sid).catalog
    catalog.source(other)
    expect(list).toHaveBeenCalledTimes(2)
    bound.delete(sid)
    const second = catalog.source(other).catalog
    pending[1]?.(ok([entry()]))
    await vi.waitFor(() => { expect(second.getSnapshot().status).toBe('ready') })
    pending[0]?.(ok([entry()]))
    await Promise.resolve()
    expect(first.getSnapshot().status).toBe('loading')
    catalog.reloadAll()
    expect(list).toHaveBeenCalledTimes(3)
    catalog.dispose()
    catalog.reloadAll()
    expect(list).toHaveBeenCalledTimes(3)
    bound.add(sid)
    expect(catalog.source(sid).catalog).not.toBe(first)
  })

  it('drops a list that settles or rejects after dispose', async () => {
    let resolve: ((value: Listed) => void) | undefined
    const list = vi.fn(() => new Promise<Listed>((settle) => { resolve = settle }))
    const catalog = new SkillCatalog(remote({ list }), () => true)
    const store = catalog.source(sid).catalog
    catalog.dispose()
    resolve?.(ok([entry()]))
    await Promise.resolve()
    await Promise.resolve()
    expect(list).toHaveBeenCalled()
    expect(store.getSnapshot().status).toBe('loading')
    let reject: ((error: unknown) => void) | undefined
    const failing = vi.fn(() => new Promise<Listed>((_resolve, settle) => { reject = settle }))
    const second = new SkillCatalog(remote({ list: failing }), () => true)
    const failed = second.source(sid).catalog
    second.dispose()
    reject?.(new Error('late'))
    await Promise.resolve()
    await Promise.resolve()
    expect(failed.getSnapshot().status).toBe('loading')
  })
})
