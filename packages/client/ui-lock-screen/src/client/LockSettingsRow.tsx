/** General Settings row: lock now, set or remove the stored password, and pick the style. */
import type { ReactNode } from 'react'
import { Button, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LockState } from './lock-store.ts'
import type { NS } from './locales.ts'
import { LOCK_THEMES, type LockTheme } from './theme-store.ts'
import css from './LockSettingsRow.module.css'

/** Lock state and actions supplied by the plugin. */
export interface LockSettingsRowInjected {
  hooks: { lock: ObservableSnapshot<LockState>; theme: ObservableSnapshot<LockTheme> }
  /** Cover the page, or ask for a first password. */
  lock(): void
  /** Ask for a new password without locking. */
  changePassword(): void
  /** Forget the stored password. */
  removePassword(): void
  /** @param theme - style for later locks. */
  setTheme(theme: LockTheme): void
}

/**
 * Render the lock-screen row.
 * @param props - lock state, actions, and locale.
 * @returns the row.
 */
export function LockSettingsRow({ useLock, useTheme, lock, changePassword, removePassword, setTheme, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<typeof NS> & InjectFace<LockSettingsRowInjected>): ReactNode {
  const hasPassword = useLock(state => state.hasPassword)
  const theme = useTheme(state => state)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('settings.title')}</div>
      <div className={css.description}>{t(hasPassword ? 'settings.set' : 'settings.unset')}</div>
      <SegmentedControl
        id="dsh-lock-screen-theme"
        className={css.theme}
        label={t('settings.theme')}
        value={theme}
        options={LOCK_THEMES.map(value => ({ value, label: t(`theme.${value}`) }))}
        onChange={setTheme}
      />
    </div>
    <div className={css.actions}>
      <Button variant="outline" size="sm" onClick={() => { changePassword() }}>{t(hasPassword ? 'settings.change' : 'settings.setPassword')}</Button>
      {hasPassword && <Button variant="outline" size="sm" onClick={() => { removePassword() }}>{t('settings.remove')}</Button>}
      <Button variant="outline" size="sm" onClick={() => { lock() }}>{t('settings.lockNow')}</Button>
    </div>
  </div>
}
