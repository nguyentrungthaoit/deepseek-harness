/** Defaults and bounds of the Activity configuration. */
import { expect, it } from 'vitest'
import { Config } from '../src/client/config.ts'

it('defaults to eight commits and a bounded speed history', () => {
  expect(Config({})).toEqual({ gitCommits: 8, speedSamples: 2_000, speedMinBucketSamples: 3, speedRecentRuns: 30 })
})

it('rejects values below the minimum', () => {
  expect(() => Config({ gitCommits: 0 })).toThrow()
  expect(() => Config({ speedRecentRuns: 1 })).toThrow()
})
