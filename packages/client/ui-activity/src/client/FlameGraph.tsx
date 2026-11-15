/**
 * The Turn flame graph: one row per model step and Tool call on a shared time
 * axis, nested calls indented under their parent. Running bars end at `now`.
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ActivitySpan, SpanKind, TurnActivity } from './activity.ts'
import { axisTicks, formatDuration, type ActivityTranslate } from './format.ts'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

/** Copy key naming each span kind. */
const KIND_LABEL: Readonly<Record<SpanKind, ActivityKey>> = {
  waiting: 'kind.waiting',
  thinking: 'kind.thinking',
  writing: 'kind.writing',
  tool: 'kind.tool',
  subagent: 'kind.subagent',
}

/** Legend order: model phases first, then calls, then the failure overlay. */
const LEGEND: readonly { readonly className: string | undefined; readonly label: ActivityKey }[] = [
  { className: css.waiting, label: 'kind.waiting' },
  { className: css.thinking, label: 'kind.thinking' },
  { className: css.writing, label: 'kind.writing' },
  { className: css.tool, label: 'kind.tool' },
  { className: css.subagent, label: 'kind.subagent' },
  { className: css.failed, label: 'kind.failed' },
]

/** Indentation per nesting level, in px. */
const INDENT_PX = 10

/** Rows a collapsed long Turn shows: its latest spans. */
export const COLLAPSED_ROWS = 12

/** Deepest indentation drawn; deeper calls share the last level. */
const MAX_INDENT_DEPTH = 4

function indent(depth: number): number {
  return Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX
}

function percent(value: number): string {
  return `${Math.min(100, Math.max(0, value * 100))}%`
}

interface SpanRowProps {
  readonly span: ActivitySpan
  readonly origin: number
  readonly range: number
  /** Clock used as the end of a running span. */
  readonly now: number
  readonly t: ActivityTranslate
}

/**
 * One timeline row: its label, and its bar with a hover and focus tooltip.
 * @param props - the span, the axis origin and length, the clock, and copy.
 * @returns the list item.
 */
const SpanRow = memo(function SpanRow({ span, origin, range, now, t }: SpanRowProps): ReactNode {
  const end = span.end ?? Math.max(now, span.start)
  const duration = end - span.start
  const name = span.name ?? t('span.step', { step: span.step })
  const kind = t(span.failed ? 'kind.failed' : KIND_LABEL[span.kind])
  const label = t(span.end === null ? 'tooltip.running' : 'tooltip.done', { name, kind, duration: formatDuration(duration, t) })
  const wait = span.firstToken === undefined ? 0 : (span.firstToken - span.start) / Math.max(1, duration)
  return (
    <li className={css.spanRow}>
      <span className={css.spanName} style={{ paddingInlineStart: indent(span.depth) }} title={name}>{name}</span>
      <span className={css.track}>
        <Tooltip label={label} side="top" portal>
          <span
            role="img"
            tabIndex={0}
            aria-label={label}
            data-kind={span.kind}
            className={clsx(css.bar, css[span.kind], span.failed && css.failed, span.end === null && css.running)}
            style={{ left: percent((span.start - origin) / range), width: percent(duration / range) }}
          >
            {wait > 0 && <span className={css.wait} style={{ width: percent(wait) }} />}
          </span>
        </Tooltip>
      </span>
    </li>
  )
})

/** Flame graph props. */
export interface FlameGraphProps {
  readonly activity: TurnActivity
  /** Current clock in Unix epoch ms; ends the axis while the Turn runs. */
  readonly now: number
  readonly t: ActivityTranslate
}

/**
 * Draw the latest Turn's spans on one time axis.
 * @param props - the folded Turn, the clock, and copy.
 * @returns the timeline section.
 */
export function FlameGraph({ activity, now, t }: FlameGraphProps): ReactNode {
  const live = activity.end === null
  const [expanded, setExpanded] = useState(false)
  const total = activity.spans.length
  const long = total > COLLAPSED_ROWS
  const collapsed = long && !expanded
  const shown = collapsed ? activity.spans.slice(-COLLAPSED_ROWS) : activity.spans
  // A collapsed Turn's axis starts at its earliest shown span so the bars keep their width.
  const origin = collapsed ? Math.min(...shown.map(span => span.start)) : activity.start
  const end = activity.end ?? now
  const range = Math.max(1, end - origin)
  const skipped = origin - activity.start
  const ticks = useMemo(() => axisTicks(skipped + range, skipped), [skipped, range])
  return (
    <section className={css.timeline} aria-label={t('timeline.label')}>
      <header className={css.sectionHead}>
        <h3 className={css.heading}>{t('timeline.heading', { turn: activity.turn })}</h3>
        <span className={clsx(css.status, live && css.statusLive)}>{t(live ? 'timeline.live' : 'timeline.done')}</span>
      </header>
      <ul className={css.legend}>
        {LEGEND.map(entry => (
          <li key={entry.label} className={css.legendItem}>
            <span className={clsx(css.swatch, entry.className)} aria-hidden />
            {t(entry.label)}
          </li>
        ))}
      </ul>
      {long && (
        <button type="button" className={css.more} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? t('timeline.showLatest', { count: COLLAPSED_ROWS }) : t('timeline.showAll', { hidden: total - COLLAPSED_ROWS, count: total })}
        </button>
      )}
      {total === 0
        ? <p className={css.empty}>{t('timeline.noSpans')}</p>
        : (
          <ol className={clsx(css.spans, expanded && long && css.spansAll)}>
            {shown.map(span => <SpanRow key={span.key} span={span} origin={origin} range={range} now={now} t={t} />)}
          </ol>
        )}
      <div className={css.axis} aria-hidden>
        {ticks.map((offset) => {
          const at = percent((offset - skipped) / range)
          return <span key={offset} className={css.tick} style={{ left: at, translate: `-${at}` }}>{formatDuration(offset, t)}</span>
        })}
      </div>
    </section>
  )
}
