/** Late input insertions preserve references, subsequent edits, and undo ownership. */
import { Context } from '@deepseek-ai/cordis'
import { UNDO_COMMAND } from 'lexical'
import { expect, it, vi } from 'vitest'
import type { InputTriggerController } from '../src/client/contract/input.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

function shell(): SessionInputShell {
  return new SessionInputShell({ actx: new Context(), defaultSink: vi.fn(), commandAttachments: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
  } })
}

it('inserts text beside an existing reference and undoes only that insertion', async () => {
  const input = shell()
  try {
    input.setDraft('@ref')
    input.insertReference({ source: 'file', ref: 'src/main.ts', label: 'main.ts', clipboardText: '@[main.ts](src/main.ts)' },
      { start: 0, end: 4, draftRev: input.state.getSnapshot().draftRev })
    const original = input.state.getSnapshot()
    expect(input.actions.insertText(' check types', input.actions.captureInsertion())).toBe(true)
    expect(input.state.getSnapshot().draft).toContain('check types')
    expect(input.state.getSnapshot().occurrences).toEqual(original.occurrences)
    input.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => { expect(input.state.getSnapshot().draft).toBe(original.draft) })
  } finally { input.dispose() }
})

it('appends plain text at the end and refuses while submit is busy', () => {
  const input = shell()
  try {
    expect(input.appendText('/field-list ')).toBe(true)
    expect(input.appendText('')).toBe(true)
    expect(input.appendText('\uFFFC')).toBe(true)
    expect(input.state.getSnapshot().draft).toBe('/field-list ')
  } finally { input.dispose() }

  const emptyLexicon = new Map<'/' | '@', readonly string[]>()
  const triggers: InputTriggerController = {
    launcher: { getSnapshot: () => null, subscribe: () => () => {} },
    lexicon: { getSnapshot: () => emptyLexicon, subscribe: () => () => {} },
    track: () => {},
    arbitrate: () => 'pass',
    onSpace: () => false,
    serializeReference: async () => '',
    adjudicate: () => new Promise(() => {}),
    openReference: () => false,
    toggleSource: () => {},
  }
  const adjudicating = new SessionInputShell({
    actx: new Context(),
    defaultSink: vi.fn(),
    inputTriggers: () => triggers,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: () => '' },
  })
  try {
    adjudicating.setDraft('/field-list ')
    adjudicating.submit()
    expect(adjudicating.snapshot.phase).toBe('adjudicating')
    expect(adjudicating.appendText('x')).toBe(false)
    expect(adjudicating.state.getSnapshot().draft).toBe('/field-list ')
  } finally { adjudicating.dispose() }

  const outcome = Promise.withResolvers<{ kind: 'success' }>()
  const submitting = shell()
  try {
    submitting.setDraft('/pending ')
    expect(submitting.beginCommand({
      name: 'pending', token: '/pending ',
      submit: () => outcome.promise,
    }, { start: 0, end: '/pending '.length, draftRev: submitting.snapshot.draftRev })).toBe(true)
    submitting.submit()
    expect(submitting.snapshot.phase).toBe('submitting')
    expect(submitting.appendText('x')).toBe(false)
    expect(submitting.state.getSnapshot().draft).toBe('/pending ')
  } finally {
    outcome.resolve({ kind: 'success' })
    submitting.dispose()
  }
})

it('refuses results captured before a user edit or after editor disposal', () => {
  const input = shell()
  input.setDraft('before')
  const span = input.actions.captureInsertion()
  input.setDraft('my newer text')
  expect(input.actions.insertText('late voice', span)).toBe(false)
  expect(input.state.getSnapshot().draft).toBe('my newer text')
  const latest = input.actions.captureInsertion()
  input.dispose()
  expect(input.actions.insertText('late voice', latest)).toBe(false)
})
