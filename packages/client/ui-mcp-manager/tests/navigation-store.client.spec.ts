/** MCP panel navigation: every open action, back, and reset. */
import { describe, expect, it } from 'vitest'
import { createNavigationStore } from '../src/client/navigation-store.ts'

/** @returns a fresh instance. */
function make() {
  return createNavigationStore().create()
}

describe('navigation store', () => {
  it('starts on the list', () => {
    expect(make().store.getSnapshot().view).toEqual({ kind: 'list' })
  })

  it('opens server, create, edit, and list', () => {
    const nav = make()
    nav.actions.openServer('a')
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'server', entryId: 'a' })
    nav.actions.openCreate()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'create' })
    nav.actions.openEdit('b')
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'edit', entryId: 'b' })
    nav.actions.openList()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'list' })
  })

  it('goes back from edit to its server, and from server, create, or list to the list', () => {
    const nav = make()
    nav.actions.openEdit('b')
    nav.actions.back()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'server', entryId: 'b' })
    nav.actions.back()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'list' })
    nav.actions.openCreate()
    nav.actions.back()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'list' })
    nav.actions.back()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'list' })
  })

  it('resets to the list and notifies subscribers', () => {
    const nav = make()
    let calls = 0
    const stop = nav.store.subscribe(() => { calls += 1 })
    nav.actions.openEdit('b')
    nav.actions.reset()
    stop()
    expect(nav.store.getSnapshot().view).toEqual({ kind: 'list' })
    expect(calls).toBe(2)
  })
})
