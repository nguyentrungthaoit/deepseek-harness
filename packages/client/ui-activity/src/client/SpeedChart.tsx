/**
 * Model speed section: the current model's median output speed and time to
 * first token, two hour-of-day bar charts so a slow part of the day stands
 * out, and a sparkline of the latest runs.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatDuration, formatRate, type ActivityTranslate } from './format.ts'
import type { SpeedBucket, SpeedProfile } from './speed.ts'
import css from './ActivityPanel.module.css'

/** Sparkline drawing box, in viewBox units. */
const SPARK_WIDTH = 100
const SPARK_HEIGHT = 24

interface HourBarsProps {
  readonly label: string
  readonly buckets: readonly SpeedBucket[]
  /** The bucket's figure, or null when the hour has none. */
  readonly value: (bucket: SpeedBucket) => number | null
  readonly text: (value: number) => string
  /** Local hour of day to highlight. */
  readonly hour: number
  readonly t: ActivityTranslate
}

function hourLabel(hour: number): string {
  return String(hour).padStart(2, '0')
}

function HourBars({ label, buckets, value, text, hour, t }: HourBarsProps): ReactNode {
  const peak = Math.max(0, ...buckets.map(bucket => value(bucket) ?? 0))
  return (
    <div className={css.chart}>
      <span className={css.meterLabel}>{label}</span>
      <ol className={css.hourBars} aria-label={label}>
        {buckets.map((bucket) => {
          const figure = value(bucket)
          const tip = figure === null
            ? t('speed.hourNone', { hour: hourLabel(bucket.hour) })
            : t('speed.hourTip', { hour: hourLabel(bucket.hour), value: text(figure), count: bucket.samples })
          return (
            <li key={bucket.hour} className={css.hourSlot}>
              <Tooltip label={tip} side="top" portal>
                <span role="img" tabIndex={0} aria-label={tip} className={css.hourTrack}>
                  <span
                    className={clsx(css.hourBar, bucket.hour === hour && css.hourNow)}
                    style={{ height: figure === null ? '0%' : `${Math.max(4, (figure / peak) * 100)}%` }}
                  />
                </span>
              </Tooltip>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The final element of a list, or `empty` for an empty list. */
function latest<T>(values: readonly T[], empty: T): T {
  return values.reduce((_, value) => value, empty)
}

function sparkline(rates: readonly number[]): { points: string; last: { x: number; y: number } } {
  const peak = Math.max(...rates)
  const coordinates = rates.map((rate, index) => ({
    x: rates.length === 1 ? SPARK_WIDTH : (index / (rates.length - 1)) * SPARK_WIDTH,
    y: SPARK_HEIGHT - (rate / peak) * SPARK_HEIGHT,
  }))
  return { points: coordinates.map(point => `${point.x},${point.y}`).join(' '), last: latest(coordinates, { x: SPARK_WIDTH, y: SPARK_HEIGHT }) }
}

/** Props of the speed section. */
export interface SpeedChartProps {
  /** The current model's history. */
  readonly profile: SpeedProfile
  /** Clock whose local hour the charts highlight, Unix epoch ms. */
  readonly now: number
  readonly t: ActivityTranslate
}

/**
 * Draw the speed section.
 * @param props - the profile, the clock, and copy.
 * @returns the section.
 */
export function SpeedChart({ profile, now, t }: SpeedChartProps): ReactNode {
  const hour = new Date(now).getHours()
  const rates = profile.recent.flatMap(sample => sample.tokensPerSecond === null ? [] : [sample.tokensPerSecond])
  const spark = rates.length === 0 ? null : sparkline(rates)
  return (
    <section className={css.speed} aria-label={t('speed.label')}>
      <header className={css.sectionHead}>
        <h3 className={css.heading}>{t('speed.heading')}</h3>
        <span className={css.status} title={profile.model}>{profile.model}</span>
      </header>
      <div className={css.stat}>
        <span className={css.meterLabel}>{t('speed.median')}</span>
        <span className={css.meterValue}>
          {profile.tokensPerSecond === null ? t('speed.unknown') : formatRate(profile.tokensPerSecond, t)}
          {' · '}
          {profile.ttftMs === null ? t('speed.unknown') : t('speed.firstToken', { value: formatDuration(profile.ttftMs, t) })}
        </span>
      </div>
      <HourBars
        label={t('speed.rateByHour')}
        buckets={profile.hours}
        value={bucket => bucket.tokensPerSecond}
        text={value => formatRate(value, t)}
        hour={hour}
        t={t}
      />
      <HourBars
        label={t('speed.ttftByHour')}
        buckets={profile.hours}
        value={bucket => bucket.ttftMs}
        text={value => formatDuration(value, t)}
        hour={hour}
        t={t}
      />
      {spark !== null && (
        <div className={css.chart}>
          <span className={css.meterLabel}>{t('speed.recent')}</span>
          <svg
            className={css.spark}
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={t('speed.recentLabel', { count: rates.length, value: formatRate(latest(rates, 0), t) })}
          >
            <polyline className={css.sparkLine} points={spark.points} fill="none" vectorEffect="non-scaling-stroke" />
            <circle className={css.sparkDot} cx={spark.last.x} cy={spark.last.y} r={1.5} />
          </svg>
        </div>
      )}
    </section>
  )
}
