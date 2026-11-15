/** Plugin configuration for the file tree's activity heatmap. */
import z from '@deepseek-ai/schemastery'

/** File-tree configuration. */
export interface Config {
  /** Whether new file trees start with the activity heatmap on; each tree can still toggle it. */
  heatmap?: boolean
  /** Seconds a touched file stays tinted before it fades back to normal. */
  heatFadeSeconds?: number
}

/** Validated file-tree configuration. */
export const Config: z<Config> = z.object({
  heatmap: z.boolean().default(true),
  heatFadeSeconds: z.natural().min(5).default(180),
})
