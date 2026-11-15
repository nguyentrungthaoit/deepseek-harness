// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSettings } from '../src/chat-settings.ts'
import { StallWarningPolicy } from '../src/client/stall-warning.ts'

const BASE: ChatSettings = { linkOpening: 'sidebar', performanceUsage: 'detailed' }

describe('StallWarningPolicy', () => {
  it('starts from the defaults and keeps explicit choices live without persistence', async () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({ mode: 'memory', status: 'ready' })
    host.set.mockRejectedValue(new Error('memory-only scope'))
    const policy = new StallWarningPolicy(host.scope)
    expect(policy.thresholds.getSnapshot()).toEqual({ model: 120, tool: 300 })
    policy.setModel(600)
    policy.setTool(1800)
    expect(policy.thresholds.getSnapshot()).toEqual({ model: 600, tool: 1800 })
    expect(host.set).toHaveBeenCalledWith('modelStallWarning', 600)
    expect(host.set).toHaveBeenCalledWith('toolStallWarning', 1800)
    await Promise.resolve()
    host.publish({ value: undefined, writable: false })
    expect(policy.thresholds.getSnapshot()).toEqual({ model: 600, tool: 1800 })
    policy.setModel(600)
    policy.setTool(1800)
    expect(host.set).toHaveBeenCalledTimes(2)
  })

  it('adopts accepted Host settings at construction and after updates', () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({ value: { ...BASE, modelStallWarning: 0, toolStallWarning: 600 } })
    const policy = new StallWarningPolicy(host.scope)
    const first = policy.thresholds.getSnapshot()
    expect(first).toEqual({ model: 0, tool: 600 })
    host.publish({ value: { ...BASE, modelStallWarning: 0, toolStallWarning: 600, linkOpening: 'new-tab' } })
    expect(policy.thresholds.getSnapshot()).toBe(first)
    host.publish({ value: { ...BASE, modelStallWarning: 300 } })
    expect(policy.thresholds.getSnapshot()).toEqual({ model: 300, tool: 600 })
  })

  it('releases its subscription when the consuming plugin unloads', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new StallWarningPolicy(host.scope)
    expect(host.listenerCount()).toBe(1)
    policy.dispose()
    expect(host.listenerCount()).toBe(0)
  })
})
