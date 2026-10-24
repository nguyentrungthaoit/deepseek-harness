/** MCP panel page selection: the server list, one server, or the create and edit forms. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The server list, one server's detail, the create form, or one server's edit form. */
export type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'server'; readonly entryId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly entryId: string }

/** Navigation state. */
export type NavigationState = { view: View }

/** Navigation actions: `back` goes edit to server and server or create to list; `reset` returns to the list. */
export type NavigationActions = {
  openList: (draft: NavigationState) => void
  openServer: (draft: NavigationState, entryId: string) => void
  openCreate: (draft: NavigationState) => void
  openEdit: (draft: NavigationState, entryId: string) => void
  back: (draft: NavigationState) => void
  reset: (draft: NavigationState) => void
}

/**
 * Create MCP panel selection before the first page render.
 * @returns the registration-owned navigation store handle.
 */
export function createNavigationStore(): EngineStoreHandle<NavigationState, NavigationActions> {
  return defineStore({
    init: (): NavigationState => ({ view: { kind: 'list' } }),
    actions: {
      openList: (draft) => { draft.view = { kind: 'list' } },
      openServer: (draft, entryId: string) => { draft.view = { kind: 'server', entryId } },
      openCreate: (draft) => { draft.view = { kind: 'create' } },
      openEdit: (draft, entryId: string) => { draft.view = { kind: 'edit', entryId } },
      back: (draft) => {
        const view = draft.view
        draft.view = view.kind === 'edit' ? { kind: 'server', entryId: view.entryId } : { kind: 'list' }
      },
      reset: (draft) => { draft.view = { kind: 'list' } },
    },
  })
}
