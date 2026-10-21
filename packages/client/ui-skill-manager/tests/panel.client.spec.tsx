// @vitest-environment jsdom
/** Skills tab body: list groups and cards, navigation, detail, form, delete, Subagent, and load states. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SkillFileVersion } from '@deepseek-ai/dsh-api-remotes/client'
import type { CatalogSnapshot, ManagedSkill, SkillDraft, SkillFailure } from '../src/client/catalog.ts'
import { en } from '../src/client/locales.ts'
import { createNavigationStore, type SkillView } from '../src/client/navigation-store.ts'
import { SkillManagerBody } from '../src/client/Panel.tsx'
import type { SkillManagerBodyProps } from '../src/client/Panel.tsx'

afterEach(() => { cleanup() })

const V1 = 'v1' as SkillFileVersion
const V2 = 'v2' as SkillFileVersion

const WRITABLE: ManagedSkill = {
  name: 'field-list',
  description: 'List the fields.',
  path: '/repo/.agents/skills/field-list.md',
  modelInvocable: true,
  subagent: false,
  source: 'project-agents',
  writable: true,
  body: 'List the fields.',
  version: V1,
}

const SECOND: ManagedSkill = {
  ...WRITABLE,
  name: 'vertex-schema-limits',
  description: 'Stay within limits.',
  subagent: true,
  body: 'Stay within limits.',
}

const READONLY: ManagedSkill = {
  name: 'bundled-review',
  description: 'Review from the bundle.',
  modelInvocable: true,
  subagent: false,
  source: 'bundled',
  writable: false,
}

const READY: CatalogSnapshot = { status: 'ready', skills: [READONLY, SECOND, WRITABLE] }

type Write = (draft: SkillDraft) => Promise<SkillFailure | undefined>
type Remove = (name: string, expectedVersion?: SkillFileVersion) => Promise<SkillFailure | undefined>

function hook<T>(store: SnapshotStore<T>) {
  return function useStore<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot()))
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function mount(
  snapshot: CatalogSnapshot = READY,
  options: { write?: Write; remove?: Remove; view?: SkillView } = {},
) {
  const catalog = createSnapshotStore<CatalogSnapshot>(snapshot)
  const views = createNavigationStore()
  if (options.view !== undefined) views.set(options.view)
  const write = vi.fn<Write>(options.write ?? (async () => undefined))
  const remove = vi.fn<Remove>(options.remove ?? (async () => undefined))
  const reload = vi.fn()
  const useInChat = vi.fn()
  const notify = vi.fn()
  const props = {
    useCatalog: hook(catalog),
    useView: hook(views),
    navigate: (next: SkillView) => { views.set(next) },
    write,
    remove,
    reload,
    useInChat,
    notify,
    t: makeTranslate(en),
  } as SkillManagerBodyProps
  const view = render(<SkillManagerBody {...props} />)
  return {
    view, write, remove, reload, useInChat, notify,
    current: () => views.getSnapshot(),
    update: (next: CatalogSnapshot) => { act(() => { catalog.set(next) }) },
    go: (next: SkillView) => { act(() => { views.set(next) }) },
  }
}

const click = (element: Element): void => { fireEvent.click(element) }

describe('Skills list', () => {
  it('groups rows into Editable and Read-only with counts, by name', () => {
    const { view } = mount()
    const editable = view.getByRole('region', { name: en['group.editable'] })
    const readonly = view.getByRole('region', { name: en['group.readonly'] })
    expect(within(editable).getByRole('heading').textContent).toBe('Editable2')
    expect(within(readonly).getByRole('heading').textContent).toBe('Read-only1')
    expect(within(editable).getAllByRole('listitem').map(row => row.querySelector('button')?.textContent))
      .toEqual(['field-list', 'vertex-schema-limits'])
    expect(view.getByRole('heading', { name: en['type.label'] })).toBeTruthy()
  })

  it('hides an empty group', () => {
    const { view } = mount({ status: 'ready', skills: [READONLY] })
    expect(view.queryByRole('region', { name: en['group.editable'] })).toBeNull()
    expect(view.getByRole('region', { name: en['group.readonly'] })).toBeTruthy()
  })

  it('gives each card one open button, then insert, then the switch, with no nesting', () => {
    const { view, useInChat, current } = mount()
    const card = view.getByRole('button', { name: 'field-list' }).closest('li')!
    const focusable = [...card.querySelectorAll('button')]
    expect(focusable.map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'field-list', 'Insert /field-list into chat', 'Subagent for field-list',
    ])
    expect(card.querySelector('button button')).toBeNull()
    click(view.getByRole('button', { name: 'Insert /field-list into chat' }))
    expect(useInChat).toHaveBeenCalledWith('field-list')
    click(view.getByRole('button', { name: 'field-list' }))
    expect(current()).toEqual({ kind: 'detail', name: 'field-list' })
  })

  it('shows a read-only card its source tag and no switch, and hides an empty source', () => {
    const { view } = mount({ status: 'ready', skills: [READONLY, { ...READONLY, name: 'plain', source: '' }] })
    const card = view.getByRole('button', { name: 'bundled-review' }).closest('li')!
    expect(card.textContent).toContain('bundled')
    expect(card.querySelector('[role="switch"]')).toBeNull()
    const plain = view.getByRole('button', { name: 'plain' }).closest('li')!
    expect(plain.querySelectorAll('span[data-tone]')).toHaveLength(0)
  })

  it('badges a card whose Subagent is on and follows the switch', async () => {
    const pending = deferred<SkillFailure | undefined>()
    const { view } = mount(READY, { write: () => pending.promise })
    const on = view.getByRole('button', { name: 'vertex-schema-limits' }).closest('li')!
    expect(within(on).getByText(en['badge.subagent'])).toBeTruthy()
    const off = view.getByRole('button', { name: 'field-list' }).closest('li')!
    expect(within(off).queryByText(en['badge.subagent'])).toBeNull()
    click(within(off).getByRole('switch'))
    expect(within(off).getByText(en['badge.subagent'])).toBeTruthy()
    await act(async () => { pending.resolve(undefined) })
  })

  it('offers search only above five skills and filters by name and description', () => {
    const many: ManagedSkill[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(name => ({
      ...WRITABLE, name, description: `The ${name} step.`,
    }))
    const few = mount({ status: 'ready', skills: many })
    expect(few.view.queryByRole('searchbox')).toBeNull()
    cleanup()
    const { view } = mount({ status: 'ready', skills: [...many, READONLY] })
    const search = view.getByRole('searchbox', { name: en['search.placeholder'] })
    expect(search.getAttribute('placeholder')).toBe(en['search.placeholder'])
    fireEvent.change(search, { target: { value: ' GAMMA ' } })
    expect(view.getAllByRole('listitem').map(row => row.querySelector('button')?.textContent)).toEqual(['gamma'])
    expect(view.queryByRole('region', { name: en['group.readonly'] })).toBeNull()
    fireEvent.change(search, { target: { value: 'bundle' } })
    expect(view.getAllByRole('listitem').map(row => row.querySelector('button')?.textContent)).toEqual(['bundled-review'])
    fireEvent.change(search, { target: { value: 'nothing-here' } })
    expect(view.queryAllByRole('listitem')).toHaveLength(0)
    expect(view.getByRole('status').textContent).toBe(en['search.empty'])
    fireEvent.change(search, { target: { value: '' } })
    expect(view.getAllByRole('listitem')).toHaveLength(6)
  })

  it('shows a text-free skeleton on the first load and disables refresh', () => {
    const { view, reload } = mount({ status: 'loading', skills: [] })
    const skeleton = view.getByRole('status', { name: en.loading })
    expect(skeleton.textContent).toBe('')
    const refresh = view.getByRole('button', { name: en['action.refresh'] }) as HTMLButtonElement
    expect(refresh.disabled).toBe(true)
    cleanup()
    const idle = mount({ status: 'idle', skills: [] })
    expect(idle.view.getByRole('status')).toBeTruthy()
    click(idle.view.getByRole('button', { name: en['action.refresh'] }))
    expect(reload).not.toHaveBeenCalled()
  })

  it('refreshes, opens create, and pins the info tooltip on click', () => {
    const { view, reload, current } = mount()
    click(view.getByRole('button', { name: en['action.refresh'] }))
    expect(reload).toHaveBeenCalledTimes(1)
    click(view.getByRole('button', { name: en['header.about'] }))
    expect(document.body.textContent).toContain(en['header.info'])
    click(view.getByRole('button', { name: en['action.create'] }))
    expect(current()).toEqual({ kind: 'create' })
  })

  it('centers a load failure with Retry when nothing is listed', () => {
    const { view, reload } = mount({ status: 'error', skills: [], message: 'offline' })
    expect(view.getByRole('alert').textContent).toBe(en['error.load'])
    click(view.getByRole('button', { name: en['action.retry'] }))
    expect(reload).toHaveBeenCalled()
    expect(view.queryByText(en.empty)).toBeNull()
  })

  it('keeps stale rows under a compact load notice with Retry', () => {
    const { view, reload } = mount({ status: 'error', skills: [WRITABLE], message: 'offline' })
    expect(view.getByRole('alert').textContent).toBe(`${en['error.load']}${en['action.retry']}`)
    expect(view.getByRole('button', { name: 'field-list' })).toBeTruthy()
    click(view.getByRole('button', { name: en['action.retry'] }))
    expect(reload).toHaveBeenCalled()
  })

  it('offers New skill from the empty state', () => {
    const { view, current } = mount({ status: 'ready', skills: [] })
    expect(view.getByText(en.empty)).toBeTruthy()
    const buttons = view.getAllByRole('button', { name: en['action.create'] })
    expect(buttons).toHaveLength(2)
    click(buttons[1]!)
    expect(current()).toEqual({ kind: 'create' })
  })
})

describe('Subagent switch', () => {
  it('writes without a body, shows the request while in flight, and reports success', async () => {
    const pending = deferred<SkillFailure | undefined>()
    const { view, write, notify } = mount(READY, { write: () => pending.promise })
    const toggle = view.getByRole('switch', { name: 'Subagent for field-list' }) as HTMLButtonElement
    click(toggle)
    expect(write).toHaveBeenCalledWith({ name: 'field-list', description: 'List the fields.', subagent: true, expectedVersion: V1 })
    expect('body' in write.mock.calls[0]![0]).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(true)
    await act(async () => { pending.resolve(undefined) })
    expect(notify).toHaveBeenCalledWith({ kind: 'subagentOn', name: 'field-list' })
    click(view.getByRole('switch', { name: 'Subagent for vertex-schema-limits' }))
    await vi.waitFor(() => { expect(notify).toHaveBeenLastCalledWith({ kind: 'subagentOff', name: 'vertex-schema-limits' }) })
  })

  it('returns to the listed value on failure and reports it', async () => {
    const { view, notify } = mount(READY, { write: async () => ({ message: 'locked', conflict: false }) })
    const toggle = view.getByRole('switch', { name: 'Subagent for field-list' })
    await act(async () => { click(toggle) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(notify).toHaveBeenCalledWith({ kind: 'saveFailed', name: 'field-list', message: 'locked' })
  })

  it('reports a conflict', async () => {
    const { view, notify } = mount(READY, { write: async () => ({ message: 'stale', conflict: true }) })
    await act(async () => { click(view.getByRole('switch', { name: 'Subagent for field-list' })) })
    expect(notify).toHaveBeenCalledWith({ kind: 'conflict', name: 'field-list' })
  })

  it('omits the version of a row that has none', async () => {
    const { version: _version, ...bare } = WRITABLE
    const { view, write } = mount({ status: 'ready', skills: [bare] })
    await act(async () => { click(view.getByRole('switch', { name: 'Subagent for field-list' })) })
    expect(write).toHaveBeenCalledWith({ name: 'field-list', description: 'List the fields.', subagent: true })
  })
})

describe('Skill detail', () => {
  it('shows a writable skill with its actions and sections', async () => {
    const { view, useInChat, notify, write, current } = mount(READY, { view: { kind: 'detail', name: 'field-list' } })
    expect(view.getByRole('heading', { name: 'field-list' })).toBeTruthy()
    expect(view.getAllByText('List the fields.')).toHaveLength(2)
    for (const title of ['section.body', 'section.source', 'section.subagent'] as const) {
      expect(view.getByRole('heading', { name: en[title] })).toBeTruthy()
    }
    expect(view.getByText('/repo/.agents/skills/field-list.md')).toBeTruthy()
    expect(view.getByText(en['subagent.help'])).toBeTruthy()
    expect(view.getByText(en['chip.subagentOff'])).toBeTruthy()
    click(view.getByRole('button', { name: en['action.use'] }))
    expect(useInChat).toHaveBeenCalledWith('field-list')
    await act(async () => { click(view.getByRole('switch', { name: 'Subagent for field-list' })) })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ subagent: true }))
    expect(notify).toHaveBeenCalledWith({ kind: 'subagentOn', name: 'field-list' })
    click(view.getByRole('button', { name: en['action.edit'] }))
    expect(current()).toEqual({ kind: 'edit', name: 'field-list' })
  })

  it('offers a read-only skill only Use in chat and goes back to the list', () => {
    const { view, current } = mount(
      { status: 'ready', skills: [{ ...READONLY, source: '' }] },
      { view: { kind: 'detail', name: 'bundled-review' } },
    )
    expect(view.queryByRole('button', { name: en['action.edit'] })).toBeNull()
    expect(view.queryByRole('button', { name: en['action.delete'] })).toBeNull()
    expect(view.queryByRole('switch')).toBeNull()
    expect(view.queryByRole('heading', { name: en['section.body'] })).toBeNull()
    expect(view.queryByRole('heading', { name: en['section.source'] })).toBeNull()
    click(view.getByRole('button', { name: en['type.label'] }))
    expect(current()).toEqual({ kind: 'list' })
  })

  it('renders the content as Markdown and says when it is empty', () => {
    const body = '# Steps\n\n- Read the **schema**\n- List the fields\n\n```ts\nconst limit = 10\n```\n'
    const { view } = mount({ status: 'ready', skills: [{ ...WRITABLE, body }] }, { view: { kind: 'detail', name: 'field-list' } })
    expect(view.getByRole('heading', { level: 1, name: 'Steps' })).toBeTruthy()
    expect(view.getByText('schema').tagName).toBe('STRONG')
    expect(view.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Read the schema', 'List the fields'])
    expect(view.container.querySelector('pre')?.textContent).toContain('const limit = 10')
    expect(view.container.textContent).not.toContain('# Steps')
    cleanup()
    const blank = mount({ status: 'ready', skills: [{ ...WRITABLE, body: '  \n' }] }, { view: { kind: 'detail', name: 'field-list' } })
    expect(blank.view.getByText(en['body.empty'])).toBeTruthy()
  })

  it('disables Edit and says so when the content could not be read', () => {
    const { body: _body, ...bare } = WRITABLE
    const { view } = mount({ status: 'ready', skills: [bare] }, { view: { kind: 'detail', name: 'field-list' } })
    expect((view.getByRole('button', { name: en['action.edit'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.getByText(en['body.unreadable'])).toBeTruthy()
  })

  it('shows the list when the viewed skill is not listed', () => {
    const { view } = mount(READY, { view: { kind: 'detail', name: 'gone' } })
    expect(view.getByRole('region', { name: en['group.editable'] })).toBeTruthy()
  })

  it('asks before deleting; Cancel and Close do not delete', () => {
    const { view, remove } = mount(READY, { view: { kind: 'detail', name: 'field-list' } })
    click(view.getByRole('button', { name: en['action.delete'] }))
    const dialog = view.getByRole('dialog', { name: 'Delete field-list?' })
    expect(dialog.textContent).toContain('This deletes .agents/skills/field-list.md from the project.')
    click(within(dialog).getByRole('button', { name: en['action.cancel'] }))
    expect(view.queryByRole('dialog')).toBeNull()
    click(view.getByRole('button', { name: en['action.delete'] }))
    click(view.getByRole('button', { name: en['action.close'] }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes with the version, reports it, and returns to the list', async () => {
    const pending = deferred<SkillFailure | undefined>()
    const { view, remove, notify, current } = mount(READY, {
      view: { kind: 'detail', name: 'field-list' }, remove: () => pending.promise,
    })
    click(view.getByRole('button', { name: en['action.delete'] }))
    click(within(view.getByRole('dialog')).getByRole('button', { name: en['confirm.action'] }))
    expect(remove).toHaveBeenCalledWith('field-list', V1)
    click(view.getByRole('button', { name: en['action.close'] }))
    expect(view.getByRole('dialog')).toBeTruthy()
    await act(async () => { pending.resolve(undefined) })
    expect(notify).toHaveBeenCalledWith({ kind: 'deleted', name: 'field-list' })
    expect(current()).toEqual({ kind: 'list' })
  })

  it('keeps the skill and reports a failed or conflicting delete', async () => {
    const remove = vi.fn<Remove>()
      .mockResolvedValueOnce({ message: 'busy', conflict: false })
      .mockResolvedValueOnce({ message: 'stale', conflict: true })
    const { view, notify, current } = mount(READY, { view: { kind: 'detail', name: 'field-list' }, remove })
    click(view.getByRole('button', { name: en['action.delete'] }))
    await act(async () => { click(within(view.getByRole('dialog')).getByRole('button', { name: en['confirm.action'] })) })
    expect(notify).toHaveBeenCalledWith({ kind: 'deleteFailed', name: 'field-list', message: 'busy' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(current()).toEqual({ kind: 'detail', name: 'field-list' })
    click(view.getByRole('button', { name: en['action.delete'] }))
    await act(async () => { click(within(view.getByRole('dialog')).getByRole('button', { name: en['confirm.action'] })) })
    expect(notify).toHaveBeenLastCalledWith({ kind: 'conflict', name: 'field-list' })
    expect(view.getByRole('heading', { name: 'field-list' })).toBeTruthy()
  })
})

describe('Skill form', () => {
  it('validates under each field without writing', () => {
    const { view, write, current } = mount(READY, { view: { kind: 'create' } })
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: 'Field List' } })
    click(view.getByRole('button', { name: en['action.save'] }))
    expect(view.getByText(en['error.name'])).toBeTruthy()
    expect(view.getByText(en['error.description'])).toBeTruthy()
    expect(view.getByLabelText(en['field.name']).getAttribute('aria-invalid')).toBe('true')
    expect(write).not.toHaveBeenCalled()
    click(view.getByRole('button', { name: en['type.label'] }))
    expect(current()).toEqual({ kind: 'list' })
  })

  it('shows help under each field and swaps it for the error in the same line', () => {
    const { view } = mount(READY, { view: { kind: 'create' } })
    const name = view.getByLabelText(en['field.name'])
    const hint = document.getElementById(name.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toBe(en['field.nameHelp'])
    expect(view.getByText(en['field.descriptionHelp'])).toBeTruthy()
    expect(view.getByText(en['field.bodyHelp'])).toBeTruthy()
    click(view.getByRole('button', { name: en['action.save'] }))
    expect(hint.textContent).toBe(en['error.name'])
    expect(view.queryByText(en['field.nameHelp'])).toBeNull()
  })

  it('previews the content as Markdown and returns to the kept text', () => {
    const { view } = mount(READY, { view: { kind: 'create' } })
    const textarea = view.getByLabelText(en['section.body']) as HTMLTextAreaElement
    const tabs = view.getByRole('tablist', { name: en['body.mode'] })
    const write = within(tabs).getByRole('tab', { name: en['body.write'] })
    const preview = within(tabs).getByRole('tab', { name: en['body.preview'] })
    expect(write.getAttribute('aria-selected')).toBe('true')
    click(preview)
    expect(view.getByText(en['body.empty'])).toBeTruthy()
    click(write)
    fireEvent.change(textarea, { target: { value: '## Check\n\n1. Open the `file`' } })
    click(preview)
    expect(preview.getAttribute('aria-selected')).toBe('true')
    expect(textarea.closest('[role="tabpanel"]')!.hasAttribute('hidden')).toBe(true)
    const panel = view.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(preview.id)
    expect(within(panel).getByRole('heading', { level: 2, name: 'Check' })).toBeTruthy()
    expect(within(panel).getByText('file').tagName).toBe('CODE')
    click(write)
    expect(view.queryByRole('heading', { name: 'Check' })).toBeNull()
    expect(textarea.value).toBe('## Check\n\n1. Open the `file`')
  })

  it('creates a skill and opens its detail', async () => {
    const { view, write, notify, current } = mount(READY, { view: { kind: 'create' } })
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: ' plan-from-pdf ' } })
    fireEvent.change(view.getByLabelText(en['section.description']), { target: { value: 'Plan.' } })
    fireEvent.change(view.getByLabelText(en['section.body']), { target: { value: 'Read the PDF.' } })
    click(view.getByRole('switch', { name: en['section.subagent'] }))
    await act(async () => { fireEvent.submit(view.getByRole('button', { name: en['action.save'] }).closest('form')!) })
    expect(write).toHaveBeenCalledWith({ name: 'plan-from-pdf', description: 'Plan.', subagent: true, body: 'Read the PDF.' })
    expect(notify).toHaveBeenCalledWith({ kind: 'saved', name: 'plan-from-pdf' })
    expect(current()).toEqual({ kind: 'detail', name: 'plan-from-pdf' })
  })

  it('renames through replaces and opens the new name', async () => {
    const pending = deferred<SkillFailure | undefined>()
    const { view, write, update, current } = mount(READY, { view: { kind: 'edit', name: 'field-list' }, write: () => pending.promise })
    expect(view.getByRole('button', { name: 'field-list' })).toBeTruthy()
    fireEvent.change(view.getByLabelText(en['field.name']), { target: { value: 'plan-from-pdf' } })
    click(view.getByRole('button', { name: en['action.save'] }))
    expect(write).toHaveBeenCalledWith({
      name: 'plan-from-pdf', description: 'List the fields.', subagent: false, body: 'List the fields.',
      replaces: 'field-list', expectedVersion: V1,
    })
    update({ status: 'ready', skills: [{ ...WRITABLE, name: 'plan-from-pdf' }] })
    expect(view.queryByText(en['form.gone'])).toBeNull()
    await act(async () => { pending.resolve(undefined) })
    expect(current()).toEqual({ kind: 'detail', name: 'plan-from-pdf' })
  })

  it('keeps typed content on a conflict and saves again with the new version', async () => {
    const { view, write, update } = mount(READY, {
      view: { kind: 'edit', name: 'field-list' }, write: async () => ({ message: 'stale', conflict: true }),
    })
    fireEvent.change(view.getByLabelText(en['section.body']), { target: { value: 'My edit.' } })
    await act(async () => { click(view.getByRole('button', { name: en['action.save'] })) })
    expect(view.getByRole('alert').textContent).toBe(en['form.conflict'])
    expect((view.getByLabelText(en['section.body']) as HTMLTextAreaElement).value).toBe('My edit.')
    update({ status: 'ready', skills: [{ ...WRITABLE, body: 'On disk.', version: V2 }] })
    await act(async () => { click(view.getByRole('button', { name: en['action.save'] })) })
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'My edit.', expectedVersion: V2 }))
  })

  it('reports another save failure and stays on the form', async () => {
    const { view, notify, current } = mount(READY, {
      view: { kind: 'edit', name: 'field-list' }, write: async () => ({ message: 'locked', conflict: false }),
    })
    await act(async () => { click(view.getByRole('button', { name: en['action.save'] })) })
    expect(notify).toHaveBeenCalledWith({ kind: 'saveFailed', name: 'field-list', message: 'locked' })
    expect(view.queryByRole('alert')).toBeNull()
    expect(current()).toEqual({ kind: 'edit', name: 'field-list' })
    click(view.getByRole('button', { name: en['action.cancel'] }))
    expect(current()).toEqual({ kind: 'detail', name: 'field-list' })
  })

  it('keeps the form when the edited skill vanishes and saves it as new', async () => {
    const { view, write, update, current } = mount(READY, { view: { kind: 'edit', name: 'field-list' } })
    fireEvent.change(view.getByLabelText(en['section.body']), { target: { value: 'Kept.' } })
    update({ status: 'ready', skills: [READONLY] })
    expect(view.getByRole('alert').textContent).toBe(en['form.gone'])
    expect((view.getByLabelText(en['section.body']) as HTMLTextAreaElement).value).toBe('Kept.')
    await act(async () => { click(view.getByRole('button', { name: en['action.save'] })) })
    expect(write).toHaveBeenCalledWith({ name: 'field-list', description: 'List the fields.', subagent: false, body: 'Kept.' })
    cleanup()
    const gone = mount(READY, { view: { kind: 'edit', name: 'missing' } })
    expect((gone.view.getByLabelText(en['field.name']) as HTMLInputElement).value).toBe('missing')
    click(gone.view.getByRole('button', { name: 'missing' }))
    expect(gone.current()).toEqual({ kind: 'list' })
    expect(current()).toEqual({ kind: 'detail', name: 'field-list' })
  })

  it('follows a view the store changes outside the body', () => {
    const first = mount(READY)
    first.go({ kind: 'detail', name: 'vertex-schema-limits' })
    expect(first.view.getByRole('heading', { name: 'vertex-schema-limits' })).toBeTruthy()
    expect(first.view.getByText(en['chip.subagentOn'])).toBeTruthy()
  })
})
