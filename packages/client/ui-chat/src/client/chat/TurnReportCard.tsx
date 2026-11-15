/** End-of-Turn report card: duration, Tool calls, edited files, tests, and the slowest Tool. */
import { memo } from 'react'
import type { TurnReport } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DiffCounts, elapsedLabel, TestScoreboard } from './OutcomeBadges.tsx'
import css from './TurnReportCard.module.css'

/**
 * Summarize a completed long Turn from its settled data, so the card also renders after a reload.
 * Files, tests, and the slowest Tool appear only when the Turn measured them.
 * @param props - the Turn's report and Chat translate seat.
 * @returns the card.
 */
export const TurnReportCard = memo(function TurnReportCard(props: {
  report: TurnReport
  t: ChatViewSlotProps['t']
}) {
  const { report, t } = props
  const title = t('chat.report.title')
  return (
    <section className={css.card} aria-label={title} data-turn-report>
      <span className={css.title}>{title}</span>
      <ul className={css.facts}>
        <li className={css.fact}>{t('chat.report.duration', { duration: elapsedLabel(report.durationMs, t) })}</li>
        <li className={css.fact}>{t('chat.report.tools', { count: report.toolCalls })}</li>
        {report.files > 0 && (
          <li className={css.fact}>
            {t('chat.report.files', { count: report.files })}
            <DiffCounts added={report.added} removed={report.removed} t={t} />
          </li>
        )}
        {report.tests !== null && (
          <li className={css.fact}>
            {t('chat.report.tests')}
            <TestScoreboard tally={report.tests} t={t} />
          </li>
        )}
        {report.slowest !== null && (
          <li className={css.fact}>
            {t('chat.report.slowest', { name: report.slowest.name, duration: elapsedLabel(report.slowest.durationMs, t) })}
          </li>
        )}
      </ul>
    </section>
  )
})
