/** Sidebar-foot Lock button, styled like the Settings trigger beneath it. */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { NS } from './locales.ts'
import css from './LockButton.module.css'

/** Lock action supplied by the plugin. */
export interface LockButtonInjected {
  /** Cover the page, or ask for a first password. */
  lock: () => void
}

/**
 * Render the lock control: icon and label in the wide column, icon only in the rail.
 * @param props - column state, locale, and the lock action.
 * @returns the button.
 */
export function LockButton({ wide, lock, t }:
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS> & InjectFace<LockButtonInjected>): ReactNode {
  return (
    <button
      type="button"
      className={wide ? css.button : `${css.button} ${css.rail}`}
      aria-label={t('button')}
      title={wide ? undefined : t('button')}
      onClick={() => { lock() }}
    >
      <LockIcon size={wide ? 16 : 18} />
      {wide && <span className={css.label}>{t('button')}</span>}
    </button>
  )
}

/**
 * Padlock outline drawn in the current text color.
 * @param props.size - edge in pixels.
 * @returns the SVG icon.
 */
export function LockIcon({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" />
      <path d="M8 10v1.5" strokeLinecap="round" />
    </svg>
  )
}
