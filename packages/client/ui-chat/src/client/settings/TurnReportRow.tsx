/** General Settings row for the end-of-Turn report card threshold. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TURN_REPORT_CHOICES, type TurnReportThreshold } from '../../chat-settings.ts'
import type { TurnReportInjected } from '../contract/slots.ts'
import { MinutesChoiceRow } from './StallWarningRows.tsx'

/** Registration-side report-threshold face. */
export interface TurnReportRowInjected extends TurnReportInjected {
  /** Change the minimum Turn runtime for the report card. */
  setTurnReport: (seconds: TurnReportThreshold) => void
}

/** Full Settings-row props. */
export type TurnReportRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<TurnReportRowInjected>

/**
 * Render the report-card threshold selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TurnReportRow(props: TurnReportRowProps) {
  const { useTurnReport, setTurnReport, t } = props
  const value = useTurnReport(seconds => seconds)
  return (
    <MinutesChoiceRow
      title={t('settings.report.title')}
      description={t('settings.report.description')}
      value={value}
      choices={TURN_REPORT_CHOICES}
      onSelect={setTurnReport}
      t={t}
    />
  )
}
