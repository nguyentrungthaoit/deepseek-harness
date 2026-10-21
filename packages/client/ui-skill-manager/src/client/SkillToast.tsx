/**
 * Transient outcome notices for the Skills tab.
 *
 * The registration owns one notice store and one `shell.overlay` entry renders
 * it, so a save, delete, or Subagent outcome stays on screen after the tab
 * that asked for it closes. Only settled outcomes are reported.
 */
import type { ReactNode } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SkillFailure } from './catalog.ts'
import type { SkillManagerKey } from './locales.ts'

/** Outcome kinds; the first four are successes. */
export type SkillToastKind =
  | 'saved' | 'deleted' | 'subagentOn' | 'subagentOff'
  | 'saveFailed' | 'deleteFailed' | 'conflict'

/** One reported outcome. `message` is the host's reason for a failure. */
export interface SkillToast {
  readonly kind: SkillToastKind
  readonly name: string
  readonly message?: string
}

/** The shown outcome; `seq` keys the banner so a repeat restarts it. */
export interface SkillToastState extends SkillToast {
  readonly seq: number
}

/** The registration's notice store with its report and dismiss actions. */
export interface SkillToastSource {
  readonly hooks: { readonly toast: SnapshotStore<SkillToastState | null> }
  /**
   * Show one outcome, replacing the one on display.
   * @param toast - the outcome.
   */
  readonly notify: (toast: SkillToast) => void
  /** Clear the shown outcome. */
  readonly dismiss: () => void
}

/**
 * Create the notice store the overlay entry shows.
 * @returns the store with its report and dismiss actions.
 */
export function createSkillToastSource(): SkillToastSource {
  const store = createSnapshotStore<SkillToastState | null>(null)
  let seq = 0
  return {
    hooks: { toast: store },
    notify: (toast) => { store.set({ ...toast, seq: ++seq }) },
    dismiss: () => { store.set(null) },
  }
}

/**
 * The outcome of a failed write or delete.
 * @param kind - the failure kind when the file did not change on disk.
 * @param name - skill name.
 * @param failure - what the catalog returned.
 * @returns a conflict notice, or `kind` with the host's message.
 */
export function failureToast(kind: 'saveFailed' | 'deleteFailed', name: string, failure: SkillFailure): SkillToast {
  return failure.conflict ? { kind: 'conflict', name } : { kind, name, message: failure.message }
}

const TEXT: Record<SkillToastKind, SkillManagerKey> = {
  saved: 'toast.saved',
  deleted: 'toast.deleted',
  subagentOn: 'toast.subagentOn',
  subagentOff: 'toast.subagentOff',
  saveFailed: 'toast.saveFailed',
  deleteFailed: 'toast.deleteFailed',
  conflict: 'conflict',
}

const SUCCESS: ReadonlySet<SkillToastKind> = new Set(['saved', 'deleted', 'subagentOn', 'subagentOff'])

/** Props of the `shell.overlay` entry: the notice store, its dismissal, and copy. */
export type SkillToastProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'skillManager'>
  & InjectFace<Omit<SkillToastSource, 'notify'>>

/**
 * Render the current outcome: a success banner, a warning, or nothing.
 * @param props - the notice hook, its dismissal, and the locale seat.
 * @returns the banner on display, or null.
 */
export function SkillManagerToast({ useToast, dismiss, t }: SkillToastProps): ReactNode {
  const toast = useToast(current => current)
  if (toast === null) return null
  const text = t(TEXT[toast.kind], { name: toast.name, message: toast.message ?? '' })
  return SUCCESS.has(toast.kind)
    ? <Toast key={toast.seq} text={text} tone="success" onDone={dismiss} />
    : <Toast key={toast.seq} text={text} icon={<IconWarningOutlineRegular />} onDone={dismiss} />
}
