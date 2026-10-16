// @vitest-environment jsdom
/** Rules and skills body: grouping, read-only rows, and a writable edit. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { CatalogSnapshot, ManagedSkill, SkillDraft } from '../src/client/catalog.ts'
import { en } from '../src/client/locales.ts'
import { SkillManagerBody } from '../src/client/Panel.tsx'
import type { SkillManagerBodyProps } from '../src/client/Panel.tsx'

afterEach(() => { cleanup() })

const RULE: ManagedSkill = {
  name: 'vertex-schema-limits',
  description: 'Stay within limits.',
  modelInvocable: true,
  kind: 'rule',
  subagent: true,
  source: 'project-agents',
  writable: true,
  body: 'Stay within limits.',
}

const WRITABLE: ManagedSkill = {
  name: 'field-list',
  description: 'List the fields.',
  modelInvocable: true,
  kind: 'skill',
  subagent: false,
  source: 'project-agents',
  writable: true,
  body: 'List the fields.',
}

const READONLY: ManagedSkill = {
  name: 'bundled-review',
  description: 'Review from the bundle.',
  modelInvocable: true,
  kind: 'skill',
  subagent: false,
  source: 'bundled',
  writable: false,
}

const READY: CatalogSnapshot = {
  status: 'ready',
  skills: [READONLY, RULE, WRITABLE],
}

function mount(
  snapshot: CatalogSnapshot = READY,
  actions: {
    write?: (draft: SkillDraft) => Promise<string | undefined>
    remove?: (name: string) => Promise<string | undefined>
  } = {},
) {
  const write = vi.fn(actions.write ?? (async (_draft: SkillDraft) => undefined))
  const remove = vi.fn(actions.remove ?? (async (_name: string) => undefined))
  const reload = vi.fn()
  const useInChat = vi.fn()
  const t = makeTranslate(en)
  const view = render(
    <SkillManagerBody
      {...{
        useCatalog: (select: (state: CatalogSnapshot) => CatalogSnapshot) => select(snapshot),
        write,
        remove,
        reload,
        useInChat,
        t,
      } as SkillManagerBodyProps}
    />,
  )
  return { view, write, remove, reload, useInChat }
}

describe('SkillManagerBody', () => {
  it('groups rules separately from every other skill', () => {
    const { view } = mount()
    const rules = view.getByRole('heading', { name: en['group.rules'] }).closest('section')
    const skills = view.getByRole('heading', { name: en['group.skills'] }).closest('section')
    expect(rules).not.toBeNull()
    expect(skills).not.toBeNull()
    expect(rules!.textContent).toContain('vertex-schema-limits')
    expect(rules!.textContent).not.toContain('field-list')
    expect(skills!.textContent).toContain('field-list')
    expect(skills!.textContent).toContain('bundled-review')
    expect(skills!.textContent).not.toContain('vertex-schema-limits')
  })

  it('offers a read-only row only use in chat', () => {
    const { view, write, useInChat } = mount()
    const row = view.getByRole('listitem', { name: 'bundled-review' })
    expect(row.textContent).toContain('Source: bundled')
    expect(view.queryByRole('button', { name: 'Edit bundled-review' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Delete bundled-review' })).toBeNull()
    expect(row.querySelector('[role="switch"]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Use bundled-review in chat' }))
    expect(useInChat).toHaveBeenCalledWith('bundled-review')
    expect(write).not.toHaveBeenCalled()
  })

  it('writes a writable skill from the edit form', () => {
    const { view, write } = mount()
    fireEvent.click(view.getByRole('button', { name: 'Edit field-list' }))
    fireEvent.change(view.getByLabelText(en['field.description']), { target: { value: 'List every field.' } })
    fireEvent.click(view.getByRole('button', { name: en['action.save'] }))
    expect(write).toHaveBeenCalledWith({
      name: 'field-list',
      description: 'List every field.',
      kind: 'skill',
      subagent: false,
      body: 'List the fields.',
    })
  })

  it('flips subagent by writing the same body', () => {
    const { view, write } = mount()
    fireEvent.click(view.getByRole('switch', { name: 'Subagent for field-list' }))
    expect(write).toHaveBeenCalledWith({
      name: 'field-list',
      description: 'List the fields.',
      kind: 'skill',
      subagent: true,
      body: 'List the fields.',
    })
  })

  it('refuses a name that is not kebab-case', () => {
    const { view, write } = mount()
    fireEvent.click(view.getByRole('button', { name: en['action.create'] }))
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: 'Field List' } })
    fireEvent.change(view.getByLabelText(en['field.description']), { target: { value: 'A description.' } })
    fireEvent.click(view.getByRole('button', { name: en['action.save'] }))
    expect(view.getByRole('alert').textContent).toBe(en['error.name'])
    expect(write).not.toHaveBeenCalled()
  })

  it('requires a description, can cancel, and submits the form as a rule', () => {
    const { view, write } = mount()
    fireEvent.click(view.getByRole('button', { name: en['action.create'] }))
    fireEvent.click(view.getByRole('button', { name: en['action.cancel'] }))
    expect(view.getByRole('heading', { name: en['group.rules'] })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: en['action.create'] }))
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: 'plan-from-pdf' } })
    fireEvent.click(view.getByRole('button', { name: en['action.save'] }))
    expect(view.getByRole('alert').textContent).toBe(en['error.description'])
    fireEvent.change(view.getByLabelText(en['field.description']), { target: { value: 'Plan.' } })
    fireEvent.change(view.getByLabelText(en['field.body']), { target: { value: 'Read the PDF.' } })
    fireEvent.click(view.getByRole('button', { name: en['kind.rule'] }))
    fireEvent.submit(view.getByRole('button', { name: en['action.save'] }).closest('form')!)
    expect(write).toHaveBeenCalledWith({
      name: 'plan-from-pdf', description: 'Plan.', kind: 'rule', subagent: false, body: 'Read the PDF.',
    })
  })

  it('renames through replaces and shows a save failure', async () => {
    const { view, write } = mount(READY, { write: async () => 'locked' })
    fireEvent.click(view.getByRole('button', { name: 'Edit field-list' }))
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: 'plan-from-pdf' } })
    fireEvent.click(view.getByRole('button', { name: en['kind.skill'] }))
    fireEvent.click(view.getByRole('button', { name: en['action.save'] }))
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ name: 'plan-from-pdf', replaces: 'field-list' }))
    expect((await view.findByRole('alert')).textContent).toBe('Could not save: locked')
  })

  it('shows the unavailable notice when write cannot run', async () => {
    const { view } = mount(READY, { write: async () => 'unavailable' })
    fireEvent.click(view.getByRole('switch', { name: 'Subagent for vertex-schema-limits' }))
    expect((await view.findByRole('alert')).textContent).toBe(en['error.unavailable'])
  })

  it('deletes a skill and reports a delete failure from a rule', async () => {
    const { view, remove, useInChat } = mount(READY, { remove: async () => 'busy' })
    fireEvent.click(view.getByRole('button', { name: 'Edit vertex-schema-limits' }))
    fireEvent.click(view.getByRole('button', { name: en['action.cancel'] }))
    fireEvent.click(view.getByRole('button', { name: 'Use vertex-schema-limits in chat' }))
    expect(useInChat).toHaveBeenCalledWith('vertex-schema-limits')
    fireEvent.click(view.getByRole('button', { name: 'Delete field-list' }))
    expect(remove).toHaveBeenCalledWith('field-list')
    fireEvent.click(view.getByRole('button', { name: 'Delete vertex-schema-limits' }))
    expect((await view.findByRole('alert')).textContent).toBe('Could not delete: busy')
  })

  it('writes an empty body when the row has none', () => {
    const { body: _body, ...rest } = WRITABLE
    const withoutBody: ManagedSkill = { ...rest, name: 'default-envelope' }
    const { view, write } = mount({ status: 'ready', skills: [withoutBody] })
    fireEvent.click(view.getByRole('switch', { name: 'Subagent for default-envelope' }))
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ body: '', subagent: true }))
  })

  it('shows an empty catalog, a load failure, and loading', () => {
    const failed = mount({ status: 'error', skills: [], message: 'offline' })
    expect(failed.view.getByText(en.empty)).toBeTruthy()
    expect(failed.view.getByRole('alert').textContent).toBe('Could not load skills: offline')
    fireEvent.click(failed.view.getByRole('button', { name: en['action.retry'] }))
    expect(failed.reload).toHaveBeenCalled()
    failed.view.unmount()
    const loading = mount({ status: 'loading', skills: [] })
    expect(loading.view.getByText(en.loading)).toBeTruthy()
    loading.view.unmount()
    const quiet = mount({ status: 'error', skills: [WRITABLE] })
    expect(quiet.view.queryByText('Could not load skills: offline')).toBeNull()
  })
})
