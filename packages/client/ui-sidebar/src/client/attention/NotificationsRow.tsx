/** General Settings row that opts in to silent desktop notifications. */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotificationPreferenceState } from './preference.ts'
import css from './NotificationsRow.module.css'

/** Registration-side notification preference. */
export interface NotificationsRowInjected {
  hooks: {
    /** Accepted opt-in and browser support, bound as useNotifications. */
    notifications: ObservableSnapshot<NotificationPreferenceState>
  }
  /** Turn notifications on (asking for permission when undecided) or off. */
  setNotifications: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type NotificationsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'sidebar'>
  & InjectFace<NotificationsRowInjected>

/**
 * Render the desktop-notification toggle.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function NotificationsRow({ useNotifications, setNotifications, t }: NotificationsRowProps) {
  const { enabled, support } = useNotifications(value => value)
  return (
    <div className={css.row}>
      <div>
        <div className={css.title}>{t('settings.notifications.title')}</div>
        <div className={css.description}>{t('settings.notifications.description')}</div>
        {support === 'denied' && <div className={css.blocked}>{t('settings.notifications.denied')}</div>}
        {support === 'unsupported' && <div className={css.blocked}>{t('settings.notifications.unsupported')}</div>}
      </div>
      <Switch
        checked={enabled}
        label={t('settings.notifications.title')}
        disabled={support !== 'ready'}
        onChange={setNotifications}
      />
    </div>
  )
}
