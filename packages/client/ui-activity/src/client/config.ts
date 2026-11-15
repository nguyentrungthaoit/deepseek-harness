/** Plugin configuration for the Activity tab's git graph and model speed history. */
import z from '@deepseek-ai/schemastery'

/** Activity tab configuration. */
export interface Config {
  /** Commits the git graph lists; the Host clamps the request to its own `maxCommits`. */
  gitCommits?: number
  /** Most model-step speed samples kept in this browser; the oldest are dropped first. */
  speedSamples?: number
  /** Samples an hour of the day needs before the speed service prefers it over the model's all-day medians. */
  speedMinBucketSamples?: number
  /** Latest runs the speed sparkline draws. */
  speedRecentRuns?: number
}

/** Validated Activity tab configuration. */
export const Config: z<Config> = z.object({
  gitCommits: z.natural().min(1).default(8),
  speedSamples: z.natural().min(1).default(2_000),
  speedMinBucketSamples: z.natural().min(1).default(3),
  speedRecentRuns: z.natural().min(2).default(30),
})
