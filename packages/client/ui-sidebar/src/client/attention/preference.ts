/** Per-browser opt-in for desktop notifications, kept beside the permission it depends on. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Local-storage key of the opt-in; the browser permission is per-origin, so the choice is too. */
export const NOTIFICATIONS_STORAGE_KEY = 'dsh.sidebar.desktopNotifications'

/** Whether this browser can show the notifications and whether the user has blocked them. */
export type NotificationSupport = 'unsupported' | 'denied' | 'ready'

/** Accepted state shown by the Settings row. */
export interface NotificationPreferenceState {
  /** The user opted in and the browser permission is granted. */
  readonly enabled: boolean
  /** Browser capability and permission summary. */
  readonly support: NotificationSupport
}

function readSupport(): NotificationSupport {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission === 'denied' ? 'denied' : 'ready'
}

function readStored(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === 'true'
  } catch (_error: unknown) {
    // Storage can be blocked; the opt-in then stays off for this page load.
    return false
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, String(enabled))
  } catch (_error: unknown) {
    // Without storage the choice only lasts until the page reloads.
  }
}

/** Opt-in toggle whose enabling asks the browser for notification permission. */
export class NotificationPreference {
  private memory = readStored()
  private readonly store = createSnapshotStore<NotificationPreferenceState>(this.compute(this.memory))
  /** Current accepted state, bound as `useNotifications`. */
  readonly state: ObservableSnapshot<NotificationPreferenceState> = this.store

  private compute(stored: boolean): NotificationPreferenceState {
    const support = readSupport()
    return {
      enabled: stored && support === 'ready' && Notification.permission === 'granted',
      support,
    }
  }

  private publish(): void {
    const next = this.compute(this.memory)
    const previous = this.store.getSnapshot()
    if (previous.enabled === next.enabled && previous.support === next.support) return
    this.store.set(next)
  }

  /** Whether a notification may be shown right now. */
  get active(): boolean {
    return this.store.getSnapshot().enabled
  }

  /** Re-read the browser permission, which the user can change outside the page. */
  refresh(): void {
    this.publish()
  }

  /**
   * Turn notifications on or off; turning on requests permission when it is undecided.
   * @param enabled - the state the user asked for.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.memory = false
    } else if (readSupport() === 'ready') {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      this.memory = permission === 'granted'
    }
    writeStored(this.memory)
    this.publish()
  }
}
