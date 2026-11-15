/** Compact counts, durations, and round axis ticks. */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { axisTicks, formatAgo, formatCount, formatDuration, formatRate, type ActivityTranslate } from '../src/client/format.ts'
import { en, zh } from '../src/client/locales.ts'

const t: ActivityTranslate = makeTranslate(en, common)

describe('formatCount', () => {
  it('keeps small counts exact and compacts thousands and millions', () => {
    expect(formatCount(999, t)).toBe('999')
    expect(formatCount(58_340, t)).toBe('58.3K')
    expect(formatCount(128_000, t)).toBe('128K')
    expect(formatCount(1_250_000, t)).toBe('1.3M')
  })
})

describe('formatDuration', () => {
  it('uses milliseconds, tenths of seconds, then minutes and seconds', () => {
    expect(formatDuration(42.4, t)).toBe('42ms')
    expect(formatDuration(12_345, t)).toBe('12.3s')
    expect(formatDuration(162_900, t)).toBe('2m 42s')
    expect(formatDuration(162_900, makeTranslate(zh))).toBe('2分42秒')
  })
})

describe('formatAgo', () => {
  it('uses the largest whole unit and reads a future time as just now', () => {
    expect(formatAgo(-5, t)).toBe('just now')
    expect(formatAgo(59_999, t)).toBe('just now')
    expect(formatAgo(5 * 60_000 + 1, t)).toBe('5m ago')
    expect(formatAgo(3 * 3_600_000, t)).toBe('3h ago')
    expect(formatAgo(50 * 3_600_000, t)).toBe('2d ago')
  })
})

describe('formatRate', () => {
  it('keeps a decimal under 100 and rounds above', () => {
    expect(formatRate(42.46, t)).toBe('42.5 tok/s')
    expect(formatRate(123.4, t)).toBe('123 tok/s')
  })
})

describe('axisTicks', () => {
  it('picks the smallest round step that yields at most five intervals', () => {
    expect(axisTicks(450)).toEqual([0, 100, 200, 300, 400])
    expect(axisTicks(9_000)).toEqual([0, 2_000, 4_000, 6_000, 8_000])
    expect(axisTicks(1)).toEqual([0])
    expect(axisTicks(10_000, 6_300)).toEqual([7_000, 8_000, 9_000, 10_000])
  })

  it('falls back to whole hours beyond the largest step', () => {
    expect(axisTicks(30 * 3_600_000)).toEqual([0, 6, 12, 18, 24, 30].map(hours => hours * 3_600_000))
  })
})
