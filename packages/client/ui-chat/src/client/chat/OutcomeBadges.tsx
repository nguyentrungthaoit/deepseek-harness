/** Compact badges for measured Turn outcomes: edit line totals, test-run counts, and elapsed spans. */
import { memo } from 'react'
import type { TestTally } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './OutcomeBadges.module.css'

/**
 * Format an elapsed span, showing spans under a second as one sub-second label.
 * @param ms - elapsed milliseconds; negatives clamp to zero.
 * @param t - Chat translate seat.
 * @returns the localized span.
 */
export function elapsedLabel(ms: number, t: ChatViewSlotProps['t']): string {
  return ms < 1000 ? t('chat.live.subSecond') : formatRunDuration(ms, t).map(part => part.text).join('')
}

/**
 * Show the last two segments of a path; the full path stays in the item's title.
 * @param path - file path as the Tool result reports it.
 * @returns the shortened path.
 */
export function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(segment => segment !== '').slice(-2).join('/')
}

/**
 * Show added and removed line counts in diff colors.
 * @param props - totals and Chat translate seat.
 * @returns the `+N −M` pair.
 */
export const DiffCounts = memo(function DiffCounts(props: {
  added: number
  removed: number
  t: ChatViewSlotProps['t']
}) {
  const { added, removed, t } = props
  return (
    <span className={css.counts}>
      <span className={css.added}>{t('chat.diff.added', { count: added })}</span>
      <span className={css.removed}>{t('chat.diff.removed', { count: removed })}</span>
    </span>
  )
})

/**
 * Show one test run's passed, failed, and skipped counts. Failures turn the board
 * red and pulse it gently unless reduced motion is requested.
 * @param props - counts and Chat translate seat.
 * @returns the scoreboard with a spoken summary.
 */
export const TestScoreboard = memo(function TestScoreboard(props: {
  tally: TestTally
  t: ChatViewSlotProps['t']
}) {
  const { tally, t } = props
  return (
    <span className={css.tests} data-test-scoreboard data-failed={tally.failed > 0 || undefined}>
      <span className={a11yCss.visuallyHidden}>
        {t('chat.tests.label', { passed: tally.passed, failed: tally.failed, skipped: tally.skipped })}
      </span>
      <span className={css.passed} aria-hidden="true">{t('chat.tests.passed', { count: tally.passed })}</span>
      <span className={css.failed} aria-hidden="true">{t('chat.tests.failed', { count: tally.failed })}</span>
      <span aria-hidden="true">{t('chat.tests.skipped', { count: tally.skipped })}</span>
    </span>
  )
})
