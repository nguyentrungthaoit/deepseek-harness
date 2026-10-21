/**
 * Skills tab body: routes the session's view to the list, one skill's detail,
 * or the create and edit form.
 *
 * The view lives in the session's navigation store, so it survives closing the
 * tab and differs per session. A detail page whose skill vanished shows the
 * list; an edit form keeps its content and saves as a new skill.
 */
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillFileVersion } from '@deepseek-ai/dsh-api-remotes/client'
import type { CatalogSnapshot, SkillDraft, SkillFailure } from './catalog.ts'
import type {} from './locales.ts'
import type { SkillView } from './navigation-store.ts'
import { SkillDetail } from './SkillDetail.tsx'
import { SkillForm } from './SkillForm.tsx'
import { SkillList } from './SkillList.tsx'
import type { SkillToast } from './SkillToast.tsx'
import css from './Panel.module.css'

/** Callbacks and the session hooks this tab injects. */
export interface SkillManagerInjected {
  hooks: {
    /** The session's skill catalog. */
    catalog: SnapshotStore<CatalogSnapshot>
    /** The session's current page. */
    view: SnapshotStore<SkillView>
  }
  /**
   * Show another page of this session's tab.
   * @param view - the page to show.
   */
  navigate: (view: SkillView) => void
  /**
   * Write one skill file.
   * @param draft - form fields.
   * @returns a failure, or undefined when the write was accepted.
   */
  write: (draft: SkillDraft) => Promise<SkillFailure | undefined>
  /**
   * Delete one writable skill.
   * @param name - skill name.
   * @param expectedVersion - the row's file version.
   * @returns a failure, or undefined when the delete was accepted.
   */
  remove: (name: string, expectedVersion?: SkillFileVersion) => Promise<SkillFailure | undefined>
  /**
   * List this session again.
   */
  reload: () => void
  /**
   * Append `/name ` to the session composer.
   * @param name - skill name.
   */
  useInChat: (name: string) => void
  /**
   * Report a settled outcome to the app-wide toast.
   * @param toast - the outcome.
   */
  notify: (toast: SkillToast) => void
}

/** The body's composed props. */
export type SkillManagerBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<SkillManagerInjected>
  & PropsLocale<'skillManager'>

/**
 * The tab body.
 * @param props - the session catalog and view, their actions, and copy.
 * @returns the page the session's view names.
 */
export function SkillManagerBody(props: SkillManagerBodyProps): ReactNode {
  const { useCatalog, useView } = props
  const snapshot = useCatalog(state => state)
  const view = useView(state => state)
  return <div className={css.root}>{page()}</div>

  function page(): ReactNode {
    if (view.kind === 'create') return <SkillForm key="create" {...props} snapshot={snapshot} />
    const skill = view.kind === 'list' ? undefined : snapshot.skills.find(row => row.name === view.name)
    if (view.kind === 'edit') {
      return <SkillForm key={`edit:${view.name}`} {...props} snapshot={snapshot} editing={view.name} skill={skill} />
    }
    if (skill !== undefined) return <SkillDetail {...props} skill={skill} />
    return <SkillList {...props} snapshot={snapshot} />
  }
}
