/** Single-field Chat preferences with process-local choices on memory-only settings scopes. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_LIVE_ACTIVITY, DEFAULT_TURN_REPORT, type ChatSettings } from '../chat-settings.ts'

/** Optional Chat settings fields whose accepted value is published as one live store. */
type SingleChatSetting = 'liveActivity' | 'turnReport'

/** Shared live value of one optional Chat setting for its Settings row and its renderers. */
export class ChatSettingPolicy<Key extends SingleChatSetting> {
  private readonly unsubscribe: () => void
  /** Current value, reconciled with accepted Host settings when available. */
  readonly value: SnapshotStore<NonNullable<ChatSettings[Key]>>

  /**
   * @param host - Chat settings scope, durable on loopback and memory-only elsewhere.
   * @param key - settings field this policy owns.
   * @param fallback - value used until the Host accepts one.
   */
  constructor(private readonly host: ConfigForm<ChatSettings>, private readonly key: Key, fallback: NonNullable<ChatSettings[Key]>) {
    this.value = createSnapshotStore(fallback)
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.[key]
      if (accepted !== undefined && accepted !== this.value.getSnapshot()) this.value.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a choice immediately and persist it when the scope supports writes.
   * @param value - Value selected by the user.
   */
  set(value: NonNullable<ChatSettings[Key]>): void {
    if (value === this.value.getSnapshot()) return
    this.value.set(value)
    void this.host.set(this.key, value).catch((_error: unknown) => {
      // The local choice remains usable when persistence is unavailable.
    })
  }
}

/** Shared live switch for the Settings row and the running status details. */
export class LiveActivityPolicy extends ChatSettingPolicy<'liveActivity'> {
  /** @param host - Chat settings scope, durable on loopback and memory-only elsewhere. */
  constructor(host: ConfigForm<ChatSettings>) { super(host, 'liveActivity', DEFAULT_LIVE_ACTIVITY) }

  /** Whether live details show. */
  get enabled(): SnapshotStore<boolean> { return this.value }

  /**
   * Publish the switch immediately and persist it when the scope supports writes.
   * @param enabled - Whether the user wants live details.
   */
  setEnabled(enabled: boolean): void { this.set(enabled) }
}

/** Shared live Turn-report threshold for the Settings row and the Turn tail. */
export class TurnReportPolicy extends ChatSettingPolicy<'turnReport'> {
  /** @param host - Chat settings scope, durable on loopback and memory-only elsewhere. */
  constructor(host: ConfigForm<ChatSettings>) { super(host, 'turnReport', DEFAULT_TURN_REPORT) }
}
