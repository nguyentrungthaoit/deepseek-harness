/** Per-session Skills tab views and how a listing settles them. */
import { describe, expect, it } from 'vitest'
import { createNavigationStore, reconcileView } from '../src/client/navigation-store.ts'
import type { SkillView } from '../src/client/navigation-store.ts'

describe('navigation store', () => {
  it('starts on the list and stores the view it is given', () => {
    const store = createNavigationStore()
    expect(store.getSnapshot()).toEqual({ kind: 'list' })
    store.set({ kind: 'create' })
    expect(store.getSnapshot()).toEqual({ kind: 'create' })
  })

  it('sends a detail page of an unlisted skill to the list and keeps every other view', () => {
    const names = new Set(['field-list'])
    const listed: SkillView = { kind: 'detail', name: 'field-list' }
    const edit: SkillView = { kind: 'edit', name: 'gone' }
    const create: SkillView = { kind: 'create' }
    expect(reconcileView(listed, names)).toBe(listed)
    expect(reconcileView({ kind: 'detail', name: 'gone' }, names)).toEqual({ kind: 'list' })
    expect(reconcileView(edit, names)).toBe(edit)
    expect(reconcileView(create, names)).toBe(create)
  })
})
