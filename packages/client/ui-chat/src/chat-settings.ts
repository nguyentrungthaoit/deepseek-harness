/** Chat display preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the work-details presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Work-details presentation modes a user can choose. */
export const TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'] as const

/** Work-details presentation mode. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/**
 * Saved value from the two-mode generation of this setting. Read as `detailed`;
 * never offered as a choice and never written back.
 */
export const LEGACY_TRANSCRIPT_VIEW_MODE = 'normal'

/** Saved `expanded` values read as `detailed`, without being offered or written back. */
export const LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = 'expanded'

/** Every value the durable field accepts: current modes plus legacy saved values. */
const TRANSCRIPT_VIEW_SETTING_VALUES = [
  ...TRANSCRIPT_VIEW_MODES, LEGACY_TRANSCRIPT_VIEW_MODE, LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE,
] as const

/** Default work details for non-Desktop Web clients. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'detailed'

/** Performance and usage detail levels accepted by user settings. */
export const PERFORMANCE_USAGE_MODES = ['compact', 'detailed'] as const

/** Performance and usage presentation. */
export type PerformanceUsageMode = typeof PERFORMANCE_USAGE_MODES[number]

/** Preserve detailed accounting for users without an explicit preference. */
export const DEFAULT_PERFORMANCE_USAGE: PerformanceUsageMode = 'detailed'

/** Destinations for ordinary clicks on Chat HTTP(S) links. */
export type LinkOpening = 'sidebar' | 'new-tab'

/** Preserve the built-in browser for users without an explicit preference. */
export const DEFAULT_LINK_OPENING: LinkOpening = 'sidebar'

/** Seconds without model progress before the running status warns; 0 turns the warning off. */
export const MODEL_STALL_WARNING_CHOICES = [0, 60, 120, 300, 600] as const

/** Accepted model-silence warning threshold, in seconds. */
export type ModelStallWarning = typeof MODEL_STALL_WARNING_CHOICES[number]

/** Shared deployments queue requests, so the default leaves room for a slow first token. */
export const DEFAULT_MODEL_STALL_WARNING: ModelStallWarning = 120

/** Seconds one Tool call may run before the running status warns; 0 turns the warning off. */
export const TOOL_STALL_WARNING_CHOICES = [0, 120, 300, 600, 1800] as const

/** Accepted Tool-runtime warning threshold, in seconds. */
export type ToolStallWarning = typeof TOOL_STALL_WARNING_CHOICES[number]

/** Builds and test runs routinely take minutes, so the default warns only past five. */
export const DEFAULT_TOOL_STALL_WARNING: ToolStallWarning = 300

/** Live running-Turn details (tool-call timeline, streamed token counts, reasoning ticker) are shown by default. */
export const DEFAULT_LIVE_ACTIVITY = true

/** Seconds a Turn must run before its end shows a report card; 0 turns the card off. */
export const TURN_REPORT_CHOICES = [0, 60, 120, 300, 600] as const

/** Accepted Turn report card threshold, in seconds. */
export type TurnReportThreshold = typeof TURN_REPORT_CHOICES[number]

/** Short Turns explain themselves, so the default reports only Turns past two minutes. */
export const DEFAULT_TURN_REPORT: TurnReportThreshold = 120

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Work-details preference; absence uses the client default, and legacy saved values remain accepted. */
  transcriptView?: TranscriptViewMode | typeof LEGACY_TRANSCRIPT_VIEW_MODE | typeof LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE | null
  /** Detail level for composer statistics and completed-Turn usage. */
  performanceUsage: PerformanceUsageMode
  /** Default destination for Chat HTTP(S) links. */
  linkOpening: LinkOpening
  /** Model-silence warning threshold for the running status, in seconds; absence uses the default. */
  modelStallWarning?: ModelStallWarning
  /** Tool-runtime warning threshold for the running status, in seconds; absence uses the default. */
  toolStallWarning?: ToolStallWarning
  /** Whether the running status shows live details; absence uses the default. */
  liveActivity?: boolean
  /** Minimum Turn runtime, in seconds, for the end-of-Turn report card; absence uses the default. */
  turnReport?: TurnReportThreshold
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsFields = {
  linkOpening: z.union(['sidebar', 'new-tab']).default(DEFAULT_LINK_OPENING),
  performanceUsage: z.union([...PERFORMANCE_USAGE_MODES]).default(DEFAULT_PERFORMANCE_USAGE),
  modelStallWarning: z.union([...MODEL_STALL_WARNING_CHOICES]).default(DEFAULT_MODEL_STALL_WARNING),
  toolStallWarning: z.union([...TOOL_STALL_WARNING_CHOICES]).default(DEFAULT_TOOL_STALL_WARNING),
  liveActivity: z.boolean().default(DEFAULT_LIVE_ACTIVITY),
  turnReport: z.union([...TURN_REPORT_CHOICES]).default(DEFAULT_TURN_REPORT),
  // Missing and unrecognized modes defer to the client's default.
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_SETTING_VALUES]).loose(),
}

/** Schema for shared configuration values. */
export const ChatSettingsSchema = z.object(ChatSettingsFields)
