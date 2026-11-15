/** Desktop notifications and the tab-title counter for Sessions that need the user. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarKey } from '../locales.ts'
import type { NotificationPreference } from './preference.ts'

/** Why a notification is shown. */
export type AttentionKind = 'waiting' | 'done'

/** Dependencies of the attention watcher. */
export interface AttentionOptions {
  /** Unified Session status. */
  readonly statuses: ObservableSnapshot<SessionStatusSnapshot>
  /** Session catalog, for display titles and which Session is open in the main view. */
  readonly list: ObservableSnapshot<SessionListState>
  /** Opt-in and permission gate for notifications. */
  readonly preference: NotificationPreference
  /** Localized sidebar copy. */
  readonly t: (key: SidebarKey) => string
}

const WAITING_COPY: Readonly<Record<string, SidebarKey>> = {
  'approval': 'notify.waiting.approval',
  'question': 'notify.waiting.question',
  'plan-review': 'notify.waiting.plan',
}

function waitingKey(requestKind: string): SidebarKey {
  return WAITING_COPY[requestKind] ?? 'notify.waiting'
}

/**
 * Watch Session status, notify without sound, and mirror the waiting count in the tab title.
 * @param options - status sources, opt-in gate and copy.
 * @returns a disposer that stops watching and restores the original title.
 */
export function watchAttention(options: AttentionOptions): () => void {
  const { statuses, list, preference, t } = options
  let previous: SessionStatusSnapshot = statuses.getSnapshot()
  let appliedPrefix: string | undefined

  const away = (id: SessionId): boolean => {
    const inMain = (list.getSnapshot().byId[id]?.retainedBy.mainView ?? 0) > 0
    return document.hidden || !document.hasFocus() || !inMain
  }

  const notify = (id: SessionId, kind: AttentionKind, body: SidebarKey): void => {
    if (!preference.active || !away(id)) return
    const title = list.getSnapshot().byId[id]?.displayTitle ?? id
    const notification = new Notification(title, { body: t(body), silent: true, tag: `${id}:${kind}` })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  const retitle = (waiting: number): void => {
    const current = document.title
    const base = appliedPrefix !== undefined && current.startsWith(appliedPrefix)
      ? current.slice(appliedPrefix.length)
      : current
    appliedPrefix = waiting === 0 ? undefined : `(${waiting}⚠) `
    document.title = (appliedPrefix ?? '') + base
  }

  const observe = (): void => {
    const next = statuses.getSnapshot()
    let waiting = 0
    for (const [id, status] of next) {
      const before = previous.get(id)
      const request = status.pendingInteraction
      if (request !== undefined) {
        waiting += 1
        if (before?.pendingInteraction?.key !== request.key) notify(id, 'waiting', waitingKey(request.kind))
      } else if (before?.running === true && status.running === false) {
        notify(id, 'done', 'notify.done')
      }
    }
    previous = next
    retitle(waiting)
  }

  const refresh = (): void => { preference.refresh() }
  observe()
  const stop = statuses.subscribe(observe)
  document.addEventListener('visibilitychange', refresh)
  return () => {
    stop()
    document.removeEventListener('visibilitychange', refresh)
    retitle(0)
  }
}
