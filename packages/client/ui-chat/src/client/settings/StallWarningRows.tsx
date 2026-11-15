/** General Settings rows for the running-status stall thresholds. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MODEL_STALL_WARNING_CHOICES, TOOL_STALL_WARNING_CHOICES,
  type ModelStallWarning, type ToolStallWarning,
} from '../../chat-settings.ts'
import type { StallWarningThresholds } from '../stall-warning.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side stall-threshold face shared by both rows. */
export interface StallWarningRowInjected {
  hooks: {
    /** Accepted thresholds bound as useStallWarning. */
    stallWarning: ObservableSnapshot<StallWarningThresholds>
  }
  /** Change the model-silence threshold. */
  setModelStallWarning: (seconds: ModelStallWarning) => void
  /** Change the Tool-runtime threshold. */
  setToolStallWarning: (seconds: ToolStallWarning) => void
}

/** Full Settings-row props. */
export type StallWarningRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<StallWarningRowInjected>

function choiceLabel(seconds: number, t: StallWarningRowProps['t']): string {
  return seconds === 0 ? t('settings.stall.off') : t('settings.stall.minutes', { count: seconds / 60 })
}

/**
 * Render a threshold selector whose choices are whole minutes in seconds, with 0 as Off.
 * @param props - row copy, current value, offered choices, change callback, and Chat translate seat.
 * @returns the preference row.
 */
export function MinutesChoiceRow<S extends number>(props: {
  title: string
  description: string
  value: S
  choices: readonly S[]
  onSelect: (seconds: S) => void
  t: StallWarningRowProps['t']
}) {
  const { title, description, value, choices, onSelect, t } = props
  return (
    <PreferenceRow
      title={title}
      description={description}
      value={String(value)}
      selectedLabel={choiceLabel(value, t)}
      options={choices.map(seconds => ({ id: String(seconds), label: choiceLabel(seconds, t) }))}
      // The menu offers only the ids built from `choices` above.
      onSelect={(id) => { onSelect(Number(id) as S) }}
    />
  )
}

/**
 * Render the model-silence threshold selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ModelStallWarningRow({ useStallWarning, setModelStallWarning, t }: StallWarningRowProps) {
  const value = useStallWarning(thresholds => thresholds.model)
  return (
    <MinutesChoiceRow
      title={t('settings.stall.model.title')}
      description={t('settings.stall.model.description')}
      value={value}
      choices={MODEL_STALL_WARNING_CHOICES}
      onSelect={setModelStallWarning}
      t={t}
    />
  )
}

/**
 * Render the Tool-runtime threshold selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ToolStallWarningRow({ useStallWarning, setToolStallWarning, t }: StallWarningRowProps) {
  const value = useStallWarning(thresholds => thresholds.tool)
  return (
    <MinutesChoiceRow
      title={t('settings.stall.tool.title')}
      description={t('settings.stall.tool.description')}
      value={value}
      choices={TOOL_STALL_WARNING_CHOICES}
      onSelect={setToolStallWarning}
      t={t}
    />
  )
}
