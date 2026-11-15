/** Localized number, duration, and time-axis helpers for the Activity tab. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** The Activity namespace's translate seat. */
export type ActivityTranslate = TranslateNS<'activity'>

/**
 * Format a token count compactly with the shared K/M templates.
 * @param value - token count.
 * @param t - Activity translate seat.
 * @returns the count, or its thousands or millions with at most one decimal.
 */
export function formatCount(value: number, t: ActivityTranslate): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * Format a duration for meters, tooltips, and axis ticks.
 * @param ms - non-negative duration in milliseconds.
 * @param t - Activity translate seat.
 * @returns whole milliseconds under a second, tenths of a second under a minute, then minutes and seconds.
 */
export function formatDuration(ms: number, t: ActivityTranslate): string {
  if (ms < 1_000) return t('duration.ms', { value: Math.round(ms) })
  if (ms < 60_000) return t('duration.seconds', { value: Math.floor(ms / 100) / 10 })
  const seconds = Math.floor(ms / 1_000)
  return t('duration.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

/** Axis spacings in ms, ascending; the first that yields at most {@link MAX_TICKS} intervals wins. */
const TICK_STEPS = [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000]

/** Most intervals the narrow panel axis shows. */
const MAX_TICKS = 5

/**
 * Choose round axis tick offsets for a time window.
 * @param to - window end, in milliseconds from the Turn start.
 * @param from - window start, in milliseconds from the Turn start.
 * @returns round offsets from the Turn start within `[from, to]`, ascending.
 */
export function axisTicks(to: number, from = 0): number[] {
  const range = to - from
  const step = TICK_STEPS.find(candidate => range / candidate <= MAX_TICKS) ?? Math.ceil(range / MAX_TICKS / 3_600_000) * 3_600_000
  const ticks: number[] = []
  for (let offset = Math.ceil(from / step) * step; offset <= to; offset += step) ticks.push(offset)
  return ticks
}

/** Milliseconds in a minute, an hour, and a day, the age scales. */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Format how long ago something happened.
 * @param ms - elapsed milliseconds; negative values read as just now.
 * @param t - Activity translate seat.
 * @returns just now, or whole minutes, hours, or days with the largest unit that fits.
 */
export function formatAgo(ms: number, t: ActivityTranslate): string {
  if (ms < MINUTE) return t('time.now')
  if (ms < HOUR) return t('time.minutes', { value: Math.floor(ms / MINUTE) })
  if (ms < DAY) return t('time.hours', { value: Math.floor(ms / HOUR) })
  return t('time.days', { value: Math.floor(ms / DAY) })
}

/**
 * Format an output speed with the shared decimal rule of the count formatter.
 * @param tokensPerSecond - non-negative speed.
 * @param t - Activity translate seat.
 * @returns the speed with one decimal under 100, otherwise whole.
 */
export function formatRate(tokensPerSecond: number, t: ActivityTranslate): string {
  const value = tokensPerSecond >= 100 ? Math.round(tokensPerSecond) : Math.round(tokensPerSecond * 10) / 10
  return t('speed.rate', { value })
}
