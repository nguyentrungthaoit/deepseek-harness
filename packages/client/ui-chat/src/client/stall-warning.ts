/** Running-status stall thresholds with process-local choices on memory-only settings scopes. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_MODEL_STALL_WARNING, DEFAULT_TOOL_STALL_WARNING,
  type ChatSettings, type ModelStallWarning, type ToolStallWarning,
} from '../chat-settings.ts'

/** Thresholds, in seconds, after which the running status reports a possible stall; 0 disables one. */
export interface StallWarningThresholds {
  /** Silence from the model: no first token, or no further output. */
  readonly model: ModelStallWarning
  /** Runtime of the longest-running dispatched Tool call. */
  readonly tool: ToolStallWarning
}

/** Shared live thresholds for the Settings rows and the running status. */
export class StallWarningPolicy {
  private readonly unsubscribe: () => void
  /** Current thresholds, reconciled with accepted Host settings when available. */
  readonly thresholds = createSnapshotStore<StallWarningThresholds>({
    model: DEFAULT_MODEL_STALL_WARNING,
    tool: DEFAULT_TOOL_STALL_WARNING,
  })

  /** @param host - Chat settings scope, durable on loopback and memory-only elsewhere. */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value
      const current = this.thresholds.getSnapshot()
      const model = accepted?.modelStallWarning ?? current.model
      const tool = accepted?.toolStallWarning ?? current.tool
      if (model !== current.model || tool !== current.tool) this.thresholds.set({ model, tool })
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a model-silence threshold immediately and persist it when the scope supports writes.
   * @param seconds - Threshold selected by the user.
   */
  setModel(seconds: ModelStallWarning): void {
    const current = this.thresholds.getSnapshot()
    if (seconds === current.model) return
    this.thresholds.set({ ...current, model: seconds })
    void this.host.set('modelStallWarning', seconds).catch((_error: unknown) => {
      // The local choice remains usable when persistence is unavailable.
    })
  }

  /**
   * Publish a Tool-runtime threshold immediately and persist it when the scope supports writes.
   * @param seconds - Threshold selected by the user.
   */
  setTool(seconds: ToolStallWarning): void {
    const current = this.thresholds.getSnapshot()
    if (seconds === current.tool) return
    this.thresholds.set({ ...current, tool: seconds })
    void this.host.set('toolStallWarning', seconds).catch((_error: unknown) => {
      // The local choice remains usable when persistence is unavailable.
    })
  }
}
