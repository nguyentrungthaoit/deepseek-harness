/** General Settings row for the running status live details. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side live-details face. */
export interface LiveActivityRowInjected {
  hooks: {
    /** Accepted switch bound as useLiveActivity. */
    liveActivity: ObservableSnapshot<boolean>
  }
  /** Turn live details on or off. */
  setLiveActivity: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type LiveActivityRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<LiveActivityRowInjected>

/**
 * Render the live-details on/off selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function LiveActivityRow({ useLiveActivity, setLiveActivity, t }: LiveActivityRowProps) {
  const enabled = useLiveActivity(value => value)
  const label = (on: boolean) => t(on ? 'settings.live.on' : 'settings.live.off')
  return (
    <PreferenceRow
      title={t('settings.live.title')}
      description={t('settings.live.description')}
      value={enabled ? 'on' : 'off'}
      selectedLabel={label(enabled)}
      options={[{ id: 'on', label: label(true) }, { id: 'off', label: label(false) }]}
      onSelect={(id) => { setLiveActivity(id === 'on') }}
    />
  )
}
