/**
 * Model speed history: per-step time to first token and output speed, folded
 * from the Chat snapshot's finished Assistant nodes, kept as a bounded rolling
 * list across Sessions in this browser, and summarized by hour of day.
 *
 * Every figure comes from recorded events: time to first token is
 * `step/start` to the first token delta; speed is provider-reported output
 * tokens over the first token to the final message.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** One finished model step's measured speed. */
export interface SpeedSample {
  /** Stable identity (`<sessionId>:<seq>`) so a re-read of the same history adds nothing. */
  readonly id: string
  /** Unix epoch ms of the step's final message. */
  readonly time: number
  /** Provider-reported model name. */
  readonly model: string
  /** Time to first token in ms; null when not recorded. */
  readonly ttftMs: number | null
  /** Output tokens per second of decode time; null when tokens or the decode window are not recorded. */
  readonly tokensPerSecond: number | null
}

/** Medians of one model's samples that fall in one hour of the day. */
export interface SpeedBucket {
  /** Local hour of day, 0 to 23. */
  readonly hour: number
  /** Samples in this hour. */
  readonly samples: number
  /** Median time to first token in ms; null when no sample in the hour recorded it. */
  readonly ttftMs: number | null
  /** Median output tokens per second; null when no sample in the hour recorded it. */
  readonly tokensPerSecond: number | null
}

/** What a model has been seen to do in this browser. */
export interface SpeedProfile {
  readonly model: string
  /** Samples of this model. */
  readonly samples: number
  /** Median time to first token over all samples, ms. */
  readonly ttftMs: number | null
  /** Median output tokens per second over all samples. */
  readonly tokensPerSecond: number | null
  /** One bucket per hour of the day, index = hour. */
  readonly hours: readonly SpeedBucket[]
  /** The newest samples, oldest first. */
  readonly recent: readonly SpeedSample[]
}

/**
 * What a model is expected to do around a time of day, for adaptive stall thresholds.
 * Another plugin reads it with `ctx.get('activitySpeed')?.expected(model, atMs)`.
 */
export interface SpeedExpectation {
  /** Samples behind the figures. */
  readonly samples: number
  /** Median time to first token in ms; null when none recorded. */
  readonly ttftMs: number | null
  /** Median output tokens per second; null when none recorded. */
  readonly tokensPerSecond: number | null
}

/** Speed history service provided by the Activity plugin. */
export interface ActivitySpeed {
  /**
   * The model's usual speed at a time of day.
   * @param model - provider-reported model name.
   * @param atMs - Unix epoch ms whose local hour of day selects the bucket.
   * @returns the hour's medians when it holds enough samples, else the model's all-day medians; undefined when the model has no samples.
   */
  expected(model: string, atMs: number): SpeedExpectation | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-model speed history kept by the Activity tab. */
    activitySpeed: ActivitySpeed
  }
}

/** Hours in a day, the bucket count. */
const HOURS = 24

function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value: unknown = Reflect.get(usage, 'outputTokens')
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Measure the finished Assistant steps of one Session.
 * @param sessionId - owning Session, part of each sample's identity.
 * @param nodes - the Chat snapshot's finalized nodes.
 * @returns a sample per non-interrupted step that names its model and recorded a first token.
 */
export function sampleSteps(sessionId: string, nodes: readonly ConversationNode[]): SpeedSample[] {
  const samples: SpeedSample[] = []
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    const step = node
    const model = step.providerMetadata?.model ?? step.requestConfig?.model
    const timing = step.timing
    if (step.interrupted === true || model === undefined || timing === undefined || timing.firstTokenTime === null) continue
    const ttftMs = timing.stepStartTime === null ? null : Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    const decodeMs = timing.completedTime - timing.firstTokenTime
    const tokens = usageOutputTokens(step.usage)
    samples.push({
      id: `${sessionId}:${step.seq}`,
      time: timing.completedTime,
      model,
      ttftMs,
      tokensPerSecond: tokens !== null && decodeMs > 0 ? tokens / (decodeMs / 1_000) : null,
    })
  }
  return samples
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  // One middle value for an odd count, two for an even count.
  const middle = sorted.slice((sorted.length - 1) >> 1, (sorted.length >> 1) + 1)
  return middle.reduce((sum, value) => sum + value, 0) / middle.length
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null)
}

function medians(samples: readonly SpeedSample[]): Pick<SpeedExpectation, 'ttftMs' | 'tokensPerSecond'> {
  return {
    ttftMs: median(present(samples.map(sample => sample.ttftMs))),
    tokensPerSecond: median(present(samples.map(sample => sample.tokensPerSecond))),
  }
}

/**
 * Summarize one model's samples.
 * @param history - all samples, in any order.
 * @param model - model to summarize.
 * @param recentCount - how many newest samples `recent` keeps.
 * @returns the profile, or undefined when the model has no samples.
 */
export function speedProfile(history: readonly SpeedSample[], model: string, recentCount: number): SpeedProfile | undefined {
  const mine = history.filter(sample => sample.model === model).sort((left, right) => left.time - right.time)
  if (mine.length === 0) return undefined
  const hours: SpeedBucket[] = []
  for (let hour = 0; hour < HOURS; hour++) {
    const inHour = mine.filter(sample => new Date(sample.time).getHours() === hour)
    hours.push({ hour, samples: inHour.length, ...medians(inHour) })
  }
  return { model, samples: mine.length, ...medians(mine), hours, recent: mine.slice(-recentCount) }
}

/** Parse stored samples, dropping any record that is not a well-formed sample. */
function parseStored(raw: string | null): SpeedSample[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Corrupt storage starts an empty history; the next write replaces it.
    void error
    return []
  }
  if (!Array.isArray(parsed)) return []
  const nullableNumber = (value: unknown): boolean => value === null || typeof value === 'number' && Number.isFinite(value)
  return parsed.filter((entry): entry is SpeedSample => typeof entry === 'object' && entry !== null
    && typeof Reflect.get(entry, 'id') === 'string' && typeof Reflect.get(entry, 'model') === 'string'
    && typeof Reflect.get(entry, 'time') === 'number' && Number.isFinite(Reflect.get(entry, 'time'))
    && nullableNumber(Reflect.get(entry, 'ttftMs')) && nullableNumber(Reflect.get(entry, 'tokensPerSecond')))
}

/** Where the history persists; the browser's `localStorage` or a stand-in. */
export type SpeedStorage = Pick<Storage, 'getItem' | 'setItem'>

/** A bounded rolling speed history. */
export interface SpeedHistory extends ActivitySpeed {
  /** Every retained sample, oldest first; the snapshot changes only when a sample is added. */
  readonly state: SnapshotStore<readonly SpeedSample[]>
  /**
   * Add samples not seen before and drop the oldest beyond the bound.
   * @param samples - measured steps.
   */
  record(samples: readonly SpeedSample[]): void
}

/** Storage key of the persisted history. */
const STORAGE_KEY = 'dsh.activity.speed'

/**
 * Create the history, reading any persisted samples.
 * @param limit - most samples retained; the oldest are dropped first.
 * @param minBucketSamples - samples an hour needs before `expected` prefers it over the all-day medians.
 * @param storage - persistence, or undefined to keep the history in memory only.
 * @returns the history.
 */
export function createSpeedHistory(limit: number, minBucketSamples: number, storage: SpeedStorage | undefined): SpeedHistory {
  let initial: SpeedSample[] = []
  try {
    initial = parseStored(storage?.getItem(STORAGE_KEY) ?? null)
  } catch (error) {
    // Blocked storage (private window, site data off) starts an empty history.
    void error
  }
  const known = new Map(initial.sort((left, right) => left.time - right.time).slice(-limit).map(sample => [sample.id, sample]))
  const state = createSnapshotStore<readonly SpeedSample[]>([...known.values()])
  return {
    state,
    record: (samples) => {
      let added = false
      for (const sample of samples) {
        if (known.has(sample.id)) continue
        known.set(sample.id, sample)
        added = true
      }
      if (!added) return
      const kept = [...known.values()].sort((left, right) => left.time - right.time).slice(-limit)
      known.clear()
      for (const sample of kept) known.set(sample.id, sample)
      state.set(kept)
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(kept))
      } catch (error) {
        // Quota or blocked storage only costs persistence; the in-memory history stands.
        void error
      }
    },
    expected: (model, atMs) => {
      const profile = speedProfile(state.getSnapshot(), model, 0)
      if (profile === undefined) return undefined
      const hour = new Date(atMs).getHours()
      const source = profile.hours.find(bucket => bucket.hour === hour && bucket.samples >= minBucketSamples) ?? profile
      return { samples: source.samples, ttftMs: source.ttftMs, tokensPerSecond: source.tokensPerSecond }
    },
  }
}
