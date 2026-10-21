/**
 * Per-session Skills tab navigation: which page the tab shows.
 *
 * The session catalog owns one store per session beside that session's
 * catalog snapshot and drops both together, so a closed and reopened tab
 * returns to the page it showed.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The list, one skill's detail, its edit form, or the create form. */
export type SkillView =
  | { readonly kind: 'list' }
  | { readonly kind: 'detail'; readonly name: string }
  | { readonly kind: 'edit'; readonly name: string }
  | { readonly kind: 'create' }

const LIST: SkillView = { kind: 'list' }

/**
 * Create one session's navigation store, starting on the list.
 * @returns the writable view store.
 */
export function createNavigationStore(): SnapshotStore<SkillView> {
  return createSnapshotStore<SkillView>(LIST)
}

/**
 * The view to keep after a successful listing. A detail page whose skill is
 * no longer listed returns to the list; an edit form stays open so the typed
 * content survives.
 * @param view - the session's current view.
 * @param names - names the listing returned.
 * @returns `view`, or the list view.
 */
export function reconcileView(view: SkillView, names: ReadonlySet<string>): SkillView {
  return view.kind === 'detail' && !names.has(view.name) ? LIST : view
}
