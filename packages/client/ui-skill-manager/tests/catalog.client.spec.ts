/** Session skill catalog: grouping, list extras, write, delete, and refresh races. */
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult, SessionId, SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import {
  groupSkills, isKebabName, SKILL_MUTATIONS_UNAVAILABLE, SkillCatalog, toManagedSkill,
} from '../src/client/catalog.ts'
import type { ManagedSkill } from '../src/client/catalog.ts'

const sid = 'session-1' as SessionId

type Listed = RemoteResult<{ readonly skills: readonly SkillEntry[] }>

function entry(extra: Partial<SkillEntry> & { body?: string } = {}): SkillEntry & { body?: string } {
  return {
    name: 'field-list',
    description: 'List the fields.',
    modelInvocable: true,
    kind: 'skill',
    subagent: false,
    source: '',
    writable: false,
    ...extra,
  }
}

describe('skill catalog helpers', () => {
  it('accepts a kebab-case name and groups rules apart from other skills', () => {
    expect(isKebabName('field-list')).toBe(true)
    expect(isKebabName('Field-List')).toBe(false)
    const rule: ManagedSkill = {
      name: 'vertex-schema-limits', description: 'limits', modelInvocable: true,
      kind: 'rule', subagent: false, source: '', writable: true,
    }
    const skill: ManagedSkill = {
      name: 'default-envelope', description: 'envelope', modelInvocable: true,
      kind: 'skill', subagent: false, source: '', writable: true,
    }
    const groups = groupSkills([skill, rule])
    expect(groups.rules.map(row => row.name)).toEqual(['vertex-schema-limits'])
    expect(groups.skills.map(row => row.name)).toEqual(['default-envelope'])
  })

  it('reads optional list fields and treats a missing kind as a skill', () => {
    const bare = toManagedSkill({
      name: 'field-list', description: 'List the fields.', modelInvocable: true,
      path: '/skills/field-list.md', whenToUse: 'schemas',
    })
    expect(bare).toMatchObject({
      kind: 'skill', subagent: false, source: '', writable: false, path: '/skills/field-list.md', whenToUse: 'schemas',
    })
    expect(bare.body).toBeUndefined()
    const rule = toManagedSkill(entry({
      name: 'vertex-schema-limits', kind: 'rule', subagent: true, source: 'project', writable: true, body: 'Stay.',
    }))
    expect(rule).toMatchObject({ kind: 'rule', subagent: true, source: 'project', writable: true, body: 'Stay.' })
  })
})

describe('SkillCatalog', () => {
  it('lists on first open, keeps rows on a failed refresh, and ignores a stale list', async () => {
    const pending: Array<(value: Listed) => void> = []
    const list = vi.fn(() => new Promise<Listed>((resolve) => { pending.push(resolve) }))
    const catalog = new SkillCatalog({ list })
    const store = catalog.source(sid)
    expect(store.getSnapshot().status).toBe('loading')
    const fresh = catalog.reload(sid)
    pending[0]?.({
      ok: true,
      value: { skills: [entry({ name: 'stale', kind: 'skill', subagent: false, source: 'old', writable: false })] },
    })
    pending[1]?.({
      ok: true,
      value: { skills: [entry({ kind: 'skill', subagent: false, source: 'project', writable: true, body: 'Body.' })] },
    })
    await fresh
    expect(store.getSnapshot().skills.map(row => row.name)).toEqual(['field-list'])
    expect(store.getSnapshot().skills[0]?.body).toBe('Body.')
    list.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'denied', {}) })
    await catalog.reload(sid)
    expect(store.getSnapshot()).toMatchObject({ status: 'error', message: 'denied' })
    expect(store.getSnapshot().skills.map(row => row.name)).toEqual(['field-list'])
  })

  it('reports a thrown list failure and a non-Error rejection', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce('boom')
    const catalog = new SkillCatalog({ list })
    const store = catalog.source(sid)
    await vi.waitFor(() => { expect(store.getSnapshot()).toMatchObject({ status: 'error', message: 'offline' }) })
    await catalog.reload(sid)
    expect(store.getSnapshot().message).toBe('boom')
  })

  it('writes and deletes when the namespace has those methods, and remembers a body the next list omits', async () => {
    const listed = entry({ kind: 'skill', subagent: false, source: 'project', writable: true })
    const list = vi.fn(async () => ({ ok: true as const, value: { skills: [listed] } }))
    const write = vi.fn(async () => ({ ok: true as const, value: {} }))
    const remove = vi.fn(async () => ({ ok: true as const, value: {} }))
    const catalog = new SkillCatalog({ list, write, delete: remove })
    catalog.source(sid)
    await vi.waitFor(() => { expect(list).toHaveBeenCalledTimes(1) })
    const saved = await catalog.write(sid, {
      name: 'plan-from-pdf', description: 'Plan.', kind: 'skill', subagent: true, body: 'Plan the PDF.', replaces: 'field-list',
    })
    expect(saved).toBeUndefined()
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: sid, name: 'plan-from-pdf', replaces: 'field-list', body: 'Plan the PDF.', subagent: true,
    }))
    list.mockResolvedValueOnce({
      ok: true as const,
      value: {
        skills: [
          entry({ name: 'field-list', kind: 'skill', subagent: false, source: 'project', writable: true }),
          entry({ name: 'plan-from-pdf', kind: 'skill', subagent: true, source: 'project', writable: true }),
        ],
      },
    })
    await catalog.reload(sid)
    const rows = catalog.source(sid).getSnapshot().skills
    expect(rows.find(row => row.name === 'plan-from-pdf')?.body).toBe('Plan the PDF.')
    expect(rows.find(row => row.name === 'field-list')?.body).toBeUndefined()
    expect(await catalog.remove(sid, 'plan-from-pdf')).toBeUndefined()
    expect(remove).toHaveBeenCalledWith({ sessionId: sid, name: 'plan-from-pdf' })
  })

  it('returns the host message, a thrown value, or unavailable when write and delete are missing', async () => {
    const list = vi.fn(async () => ({ ok: true as const, value: { skills: [] } }))
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { message: 'locked' } })
      .mockRejectedValueOnce(new Error('disk'))
      .mockRejectedValueOnce(7)
    const catalog = new SkillCatalog({ list, write, delete: vi.fn() })
    const draft = { name: 'field-list', description: 'List.', kind: 'skill' as const, subagent: false, body: '' }
    expect(await catalog.write(sid, draft)).toBe('locked')
    expect(await catalog.write(sid, draft)).toBe('disk')
    expect(await catalog.write(sid, draft)).toBe('7')
    const bare = new SkillCatalog({ list })
    expect(await bare.write(sid, draft)).toBe(SKILL_MUTATIONS_UNAVAILABLE)
    expect(await bare.remove(sid, 'field-list')).toBe(SKILL_MUTATIONS_UNAVAILABLE)
  })

  it('keeps a renamed file body when the replacement name does not change', async () => {
    const list = vi.fn(async (): Promise<Listed> => ({ ok: true, value: { skills: [] } }))
    const write = vi.fn(async () => ({ ok: true as const, value: {} }))
    const remove = vi.fn(async () => ({ ok: true as const, value: {} }))
    const catalog = new SkillCatalog({ list, write, delete: remove })
    expect(await catalog.remove(sid, 'field-list')).toBeUndefined()
    const draft = { name: 'field-list', description: 'List.', kind: 'skill' as const, subagent: false, body: 'Keep.' }
    expect(await catalog.write(sid, draft)).toBeUndefined()
    expect(await catalog.write(sid, { ...draft, replaces: 'field-list' })).toBeUndefined()
    list.mockResolvedValueOnce({
      ok: true as const,
      value: { skills: [entry({ kind: 'skill', subagent: false, source: 'project', writable: true })] },
    })
    await catalog.reload(sid)
    expect(catalog.source(sid).getSnapshot().skills[0]?.body).toBe('Keep.')
  })

  it('drops a list that settles or rejects after dispose', async () => {
    let resolve: ((value: Listed) => void) | undefined
    const list = vi.fn(() => new Promise<Listed>((settle) => { resolve = settle }))
    const catalog = new SkillCatalog({ list })
    const store = catalog.source(sid)
    catalog.dispose()
    resolve?.({ ok: true, value: { skills: [entry()] } })
    await Promise.resolve()
    await Promise.resolve()
    expect(list).toHaveBeenCalled()
    expect(store.getSnapshot().status).toBe('loading')
    let reject: ((error: unknown) => void) | undefined
    const failing = vi.fn(() => new Promise<Listed>((_resolve, settle) => { reject = settle }))
    const other = new SkillCatalog({ list: failing })
    const failed = other.source(sid)
    other.dispose()
    reject?.(new Error('late'))
    await Promise.resolve()
    await Promise.resolve()
    expect(failed.getSnapshot().status).toBe('loading')
  })
})
