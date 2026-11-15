/** Speed samples from finished steps, hour-of-day profiles, and the bounded persisted history. */
import { describe, expect, it, vi } from 'vitest'
import { createSpeedHistory, sampleSteps, speedProfile, type SpeedSample } from '../src/client/speed.ts'
import { assistant, result } from './fixtures.client.ts'

/** Unix epoch ms at a local hour of 2026-03-02. */
const at = (hour: number, minute = 0) => new Date(2026, 2, 2, hour, minute).getTime()

function sample(id: string, time: number, ttftMs: number | null, tokensPerSecond: number | null, model = 'm'): SpeedSample {
  return { id, time, model, ttftMs, tokensPerSecond }
}

describe('sampleSteps', () => {
  it('measures first-token latency and output speed over the decode window', () => {
    const [first, second, third] = sampleSteps('s', [
      assistant({ turn: 1, step: 0, time: 5_000, model: 'deepseek-v4', usage: { outputTokens: 100 }, timing: { stepStartTime: 1_000, firstTokenTime: 2_000, completedTime: 4_000 } }),
      assistant({ turn: 1, step: 1, time: 9_000, model: 'deepseek-v4', timing: { stepStartTime: null, firstTokenTime: 6_000, completedTime: 8_000 } }),
      assistant({ turn: 1, step: 2, time: 9_500, model: 'deepseek-v4', usage: { outputTokens: 10 }, timing: { stepStartTime: 9_000, firstTokenTime: 9_100, completedTime: 9_100 } }),
    ])
    expect(first).toEqual({ id: 's:5000', time: 4_000, model: 'deepseek-v4', ttftMs: 1_000, tokensPerSecond: 50 })
    expect(second).toEqual({ id: 's:9000', time: 8_000, model: 'deepseek-v4', ttftMs: null, tokensPerSecond: null })
    expect(third).toMatchObject({ ttftMs: 100, tokensPerSecond: null })
  })

  it('skips steps that are interrupted, unnamed, untimed, or without a first token, and other nodes', () => {
    const timing = { stepStartTime: 1_000, firstTokenTime: 1_100, completedTime: 2_000 }
    expect(sampleSteps('s', [
      assistant({ turn: 1, step: 0, time: 1, model: 'm', timing, interrupted: true }),
      assistant({ turn: 1, step: 1, time: 2, timing }),
      assistant({ turn: 1, step: 2, time: 3, model: 'm' }),
      assistant({ turn: 1, step: 3, time: 4, model: 'm', timing: { ...timing, firstTokenTime: null } }),
      result({ callId: 'c', name: 'x', callTime: 1, time: 2 }),
    ])).toEqual([])
  })

  it('ignores unusable token counts', () => {
    const timing = { stepStartTime: 0, firstTokenTime: 100, completedTime: 1_100 }
    const usages = [undefined, 'x', null, { outputTokens: 'x' }, { outputTokens: 0 }, { outputTokens: Number.NaN }]
    const speeds = usages.map((usage, step) => sampleSteps('s', [assistant({ turn: 1, step, time: step, model: 'm', usage, timing })])[0]!.tokensPerSecond)
    expect(speeds).toEqual([null, null, null, null, null, null])
  })

  it('names the model from the request configuration when no metadata was reported', () => {
    const node = { ...assistant({ turn: 1, step: 0, time: 1, timing: { stepStartTime: 0, firstTokenTime: 1, completedTime: 2 } }), requestConfig: { provider: 'p', model: 'configured' } }
    expect(sampleSteps('s', [node])[0]!.model).toBe('configured')
  })
})

describe('speedProfile', () => {
  it('takes medians per hour of day and over all samples of the model', () => {
    const history = [
      sample('1', at(9), 1_000, 30), sample('2', at(9, 30), 3_000, 50), sample('3', at(9, 45), 2_000, null),
      sample('4', at(14), null, 80), sample('5', at(14, 5), 500, 70, 'other'),
    ]
    const profile = speedProfile(history, 'm', 2)!
    expect(profile).toMatchObject({ model: 'm', samples: 4, ttftMs: 2_000, tokensPerSecond: 50 })
    expect(profile.hours).toHaveLength(24)
    expect(profile.hours[9]).toEqual({ hour: 9, samples: 3, ttftMs: 2_000, tokensPerSecond: 40 })
    expect(profile.hours[14]).toEqual({ hour: 14, samples: 1, ttftMs: null, tokensPerSecond: 80 })
    expect(profile.hours[3]).toEqual({ hour: 3, samples: 0, ttftMs: null, tokensPerSecond: null })
    expect(profile.recent.map(entry => entry.id)).toEqual(['3', '4'])
  })

  it('has no profile for an unseen model', () => {
    expect(speedProfile([sample('1', 1, 1, 1)], 'x', 5)).toBeUndefined()
  })
})

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [['dsh.activity.speed', initial]])
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
  }
}

describe('createSpeedHistory', () => {
  it('records new samples once, bounds the history, and persists it', () => {
    const storage = memoryStorage()
    const history = createSpeedHistory(3, 2, storage)
    const listener = vi.fn()
    history.state.subscribe(listener)
    history.record([sample('2', 20, 1, 1), sample('1', 10, 1, 1)])
    expect(history.state.getSnapshot().map(entry => entry.id)).toEqual(['1', '2'])
    const stored = history.state.getSnapshot()
    history.record([sample('1', 10, 9, 9)])
    expect(history.state.getSnapshot()).toBe(stored)
    history.record([sample('3', 30, 1, 1), sample('4', 40, 1, 1)])
    expect(history.state.getSnapshot().map(entry => entry.id)).toEqual(['2', '3', '4'])
    const persisted = JSON.parse(storage.data.get('dsh.activity.speed')!) as SpeedSample[]
    expect(persisted.map(entry => entry.id)).toEqual(['2', '3', '4'])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('restores valid stored samples within the bound and drops malformed ones', () => {
    const raw = JSON.stringify([
      sample('a', 1, 1, 1), sample('b', 2, 1, 1), sample('c', 3, null, null), null, 'x', { id: 'bad' },
      { ...sample('d', 4, 1, 1), time: 'x' }, { ...sample('e', 5, 1, 1), ttftMs: 'x' }, { ...sample('f', 6, 1, 1), model: 1 },
    ])
    const history = createSpeedHistory(2, 1, memoryStorage(raw))
    expect(history.state.getSnapshot().map(entry => entry.id)).toEqual(['b', 'c'])
  })

  it('starts empty from unreadable storage and keeps working when storage fails or is absent', () => {
    for (const raw of ['{', '{}']) {
      expect(createSpeedHistory(5, 1, memoryStorage(raw)).state.getSnapshot()).toEqual([])
    }
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } }
    const history = createSpeedHistory(5, 1, blocked)
    history.record([sample('1', 1, 1, 1)])
    expect(history.state.getSnapshot()).toHaveLength(1)
    const memory = createSpeedHistory(5, 1, undefined)
    memory.record([sample('1', 1, 1, 1)])
    expect(memory.state.getSnapshot()).toHaveLength(1)
  })

  it('expects the hour medians when it has enough samples, otherwise the model overall medians', () => {
    const history = createSpeedHistory(10, 2, undefined)
    history.record([
      sample('1', at(9), 1_000, 20), sample('2', at(9, 10), 3_000, 40), sample('3', at(15), 9_000, 100),
    ])
    expect(history.expected('m', at(9, 59))).toEqual({ samples: 2, ttftMs: 2_000, tokensPerSecond: 30 })
    expect(history.expected('m', at(15))).toEqual({ samples: 3, ttftMs: 3_000, tokensPerSecond: 40 })
    expect(history.expected('unknown', at(9))).toBeUndefined()
  })
})
