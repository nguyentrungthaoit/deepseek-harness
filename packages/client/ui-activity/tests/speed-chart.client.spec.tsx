// @vitest-environment jsdom
/** The speed section: medians, hour-of-day bars with a highlighted current hour, and the recent-runs sparkline. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { SpeedChart } from '../src/client/SpeedChart.tsx'
import { en } from '../src/client/locales.ts'
import { speedProfile, type SpeedSample } from '../src/client/speed.ts'

afterEach(cleanup)

const t = makeTranslate(en, common)
const at = (hour: number) => new Date(2026, 2, 2, hour, 30).getTime()

function sample(id: string, hour: number, ttftMs: number | null, tokensPerSecond: number | null): SpeedSample {
  return { id, time: at(hour) + Number(id), model: 'deepseek-v4', ttftMs, tokensPerSecond }
}

function mount(history: readonly SpeedSample[], now = at(9)) {
  const profile = speedProfile(history, 'deepseek-v4', 30)!
  const view = render(<SpeedChart profile={profile} now={now} t={t} />)
  return { view, section: within(view.getByRole('region', { name: en['speed.label'] })) }
}

describe('SpeedChart', () => {
  it('shows the model, its medians, and a bar per hour of the day', () => {
    const { view, section } = mount([sample('1', 9, 1_000, 30), sample('2', 9, 3_000, 50), sample('3', 14, 500, 100)])
    expect(view.getByRole('heading').textContent).toBe('Model speed')
    expect(section.getByText('deepseek-v4')).toBeTruthy()
    expect(section.getByText('Median')).toBeTruthy()
    expect(section.getByText('50 tok/s · first token 1s').textContent).toBeTruthy()
    const speedBars = within(view.getByLabelText(en['speed.rateByHour'])).getAllByRole('img')
    expect(speedBars).toHaveLength(24)
    expect(speedBars[9]!.getAttribute('aria-label')).toBe('09:00 · 40 tok/s · 2 runs')
    expect(speedBars[14]!.getAttribute('aria-label')).toBe('14:00 · 100 tok/s · 1 runs')
    expect(speedBars[3]!.getAttribute('aria-label')).toBe('03:00 · no data')
    const heights = speedBars.map(bar => (bar.firstElementChild as HTMLElement).style.height)
    expect(heights[14]).toBe('100%')
    expect(heights[9]).toBe('40%')
    expect(heights[3]).toBe('0%')
    const ttftBars = within(view.getByLabelText(en['speed.ttftByHour'])).getAllByRole('img')
    expect(ttftBars[9]!.getAttribute('aria-label')).toBe('09:00 · 2s · 2 runs')
    expect(ttftBars[14]!.getAttribute('aria-label')).toBe('14:00 · 500ms · 1 runs')
    // Only the current hour's bar carries the highlight class.
    const highlighted = speedBars.filter(bar => bar.firstElementChild!.className.includes('hourNow'))
    expect(highlighted).toEqual([speedBars[9]])
  })

  it('draws the recent runs as a sparkline ending on the latest speed', () => {
    const { view } = mount([sample('1', 9, 1_000, 20), sample('2', 9, 1_000, 40), sample('3', 10, 1_000, 30)])
    const spark = view.getByRole('img', { name: 'Last 3 runs, latest 30 tok/s' })
    expect(spark.querySelector('polyline')!.getAttribute('points')).toBe('0,12 50,0 100,6')
    expect(spark.querySelector('circle')!.getAttribute('cx')).toBe('100')
  })

  it('places a single run at the right edge', () => {
    const { view } = mount([sample('1', 9, 1_000, 20)])
    const spark = view.getByRole('img', { name: 'Last 1 runs, latest 20 tok/s' })
    expect(spark.querySelector('polyline')!.getAttribute('points')).toBe('100,0')
  })

  it('reports unknown figures and omits the sparkline when nothing was measured', () => {
    const { view, section } = mount([sample('1', 9, null, null)])
    expect(section.getByText('n/a · n/a')).toBeTruthy()
    expect(view.queryByText(en['speed.recent'])).toBeNull()
    const bars = within(view.getByLabelText(en['speed.rateByHour'])).getAllByRole('img')
    expect(bars.every(bar => (bar.firstElementChild as HTMLElement).style.height === '0%')).toBe(true)
  })
})
