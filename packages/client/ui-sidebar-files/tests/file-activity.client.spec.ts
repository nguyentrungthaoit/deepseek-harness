/** The activity derivation: which calls count, how paths agree, and how records age. */
import { describe, expect, it } from 'vitest'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { activityOf, canonicalPath, FileActivityTracker, intensityOf } from '../src/client/file-activity.ts'
import { toolCall, toolResult } from './scripted-events.client.ts'

const FADE = 100_000

describe('activityOf', () => {
  it.each([
    ['read', { file_path: 'a.ts' }, 'read'],
    ['read_image', { file_path: 'a.png' }, 'read'],
    ['read_document', { file_path: 'a.pdf' }, 'read'],
    ['edit', { file_path: 'a.ts' }, 'edit'],
    ['write', { file_path: 'a.ts' }, 'edit'],
    ['str_replace_editor', { path: 'a.ts', command: 'view' }, 'read'],
    ['str_replace_editor', { path: 'a.ts', command: 'create' }, 'create'],
    ['str_replace_editor', { path: 'a.ts', command: 'insert' }, 'edit'],
  ])('reads %s %j as %s', (name, args, kind) => {
    expect(activityOf(name, JSON.stringify(args))).toMatchObject({ kind })
  })
  it('marks only write as able to create', () => {
    expect(activityOf('write', '{"file_path":"a"}')?.writes).toBe(true)
    expect(activityOf('edit', '{"file_path":"a"}')?.writes).toBe(false)
  })
  it.each([
    ['read', '{'], ['read', '[]'], ['read', '3'], ['read', '{"file_path":" "}'], ['write', '{}'], ['edit', '{}'],
    ['str_replace_editor', '{"command":"view"}'], ['bash', '{"file_path":"a"}'],
  ])('ignores %s with arguments %s', (name, args) => {
    expect(activityOf(name, args)).toBeNull()
  })
})

describe('canonicalPath', () => {
  it.each([
    ['src/a.ts', '/work/app', '/work/app/src/a.ts'],
    ['./src/../a.ts', '/work/app/', '/work/app/a.ts'],
    ['/work//app/a.ts', '/x', '/work/app/a.ts'],
    ['src\\a.ts', 'C:\\Work\\app', 'c:/Work/app/src/a.ts'],
    ['C:\\Work\\app/src/a.ts', '/ignored', 'c:/Work/app/src/a.ts'],
    ['a.ts', '/', '/a.ts'],
  ])('spells %s under %s as %s', (path, root, expected) => {
    expect(canonicalPath(path, root)).toBe(expected)
  })
})

describe('intensityOf', () => {
  const heat = { kind: 'read', reads: 1, edits: 0, at: 1000 } as const
  it('falls linearly from the touch to the end of the fade, clamped', () => {
    expect(intensityOf(heat, 1000, FADE)).toBe(1)
    expect(intensityOf(heat, 1000 + FADE / 2, FADE)).toBe(0.5)
    expect(intensityOf(heat, 1000 + FADE * 2, FADE)).toBe(0)
    expect(intensityOf(heat, 0, FADE)).toBe(1)
  })
})

describe('FileActivityTracker', () => {
  function setup(now = 10_000) {
    const source = new MutableSessionEventSource()
    const tracker = new FileActivityTracker(source, FADE, () => now)
    return { source, tracker }
  }

  it('records a call only once its result settles without an error', () => {
    const { source, tracker } = setup()
    const first = tracker.getSnapshot()
    expect(first.files.size).toBe(0)
    source.append(toolCall('c1', 'edit', { file_path: 'a.ts' }, 9000))
    expect(tracker.getSnapshot()).toBe(first)
    source.append(toolResult('c1', 9100))
    expect(tracker.getSnapshot().files.get('a.ts')).toEqual({ kind: 'edit', reads: 0, edits: 1, at: 9100 })
    source.append(toolCall('c2', 'edit', { file_path: 'b.ts' }, 9200))
    source.append(toolResult('c2', 9300, { isError: true }))
    source.append(toolResult('orphan', 9400))
    source.append(toolCall('sh', 'bash', { command: 'ls' }, 9500))
    source.append(toolResult('sh', 9600))
    expect(tracker.getSnapshot().files.has('b.ts')).toBe(false)
  })

  it('counts touches, keeps the strongest kind, and turns a write that created into a creation', () => {
    const { source, tracker } = setup()
    source.append(toolCall('w', 'write', { file_path: 'n.ts' }, 1))
    source.append(toolResult('w', 9000, { meta: { operation: 'create' } }))
    source.append(toolCall('w2', 'write', { file_path: 'o.ts' }, 1))
    source.append(toolResult('w2', 9000, { meta: { operation: 'update' } }))
    source.append(toolCall('w3', 'write', { file_path: 'p.ts' }, 1))
    source.append(toolResult('w3', 9000))
    source.append(toolCall('e', 'edit', { file_path: 'n.ts' }, 1))
    source.append(toolResult('e', 9500))
    source.append(toolCall('r1', 'read', { file_path: 'o.ts' }, 1))
    source.append(toolResult('r1', 9600))
    source.append(toolCall('r2', 'read', { file_path: 'o.ts' }, 1))
    source.append(toolResult('r2', 9100))
    const { files } = tracker.getSnapshot()
    expect(files.get('n.ts')).toEqual({ kind: 'create', reads: 0, edits: 1, at: 9500 })
    expect(files.get('o.ts')).toEqual({ kind: 'edit', reads: 2, edits: 1, at: 9600 })
    expect(files.get('p.ts')?.kind).toBe('edit')
  })

  it('never records events older than the fade and prunes records that expired', () => {
    let now = 10_000
    const source = new MutableSessionEventSource()
    const tracker = new FileActivityTracker(source, FADE, () => now)
    source.append(toolCall('old', 'read', { file_path: 'old.ts' }, 1))
    source.append(toolResult('old', 10_000 - FADE - 1))
    expect(tracker.getSnapshot().files.size).toBe(0)
    source.append(toolCall('a', 'read', { file_path: 'a.ts' }, 1))
    source.append(toolResult('a', 10_000))
    now = 10_000 + FADE + 500
    source.append(toolCall('b', 'read', { file_path: 'b.ts' }, 1))
    source.append(toolResult('b', now))
    expect([...tracker.getSnapshot().files.keys()]).toEqual(['b.ts'])
  })

  it('reads a replaced window whole and ignores non-event entries, prepends, and settlements', () => {
    const { source, tracker } = setup()
    source.replace([
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 0, time: 1, data: {} } } as never,
      toolCall('c', 'read', { file_path: 'a.ts' }, 1),
      toolResult('c', 9000),
      { type: 'event', event: { type: 'turn/start', seq: 3, time: 1, data: {} } } as never,
    ], false)
    const before = tracker.getSnapshot()
    expect(before.files.get('a.ts')?.reads).toBe(1)
    source.prepend([toolCall('p', 'read', { file_path: 'p.ts' }, 1), toolResult('p', 9000)], false)
    expect(tracker.getSnapshot()).toBe(before)
    source.settleAssistant('attempt' as never)
    expect(tracker.getSnapshot()).toBe(before)
  })

  it('catches up whole when the window moved while nobody asked', () => {
    const { source, tracker } = setup()
    tracker.getSnapshot()
    source.append(toolCall('a', 'read', { file_path: 'a.ts' }, 1))
    source.append(toolResult('a', 9000))
    source.append(toolCall('b', 'read', { file_path: 'b.ts' }, 1))
    expect([...tracker.getSnapshot().files.keys()]).toEqual(['a.ts'])
  })

  it('passes subscriptions through to the event window', () => {
    const { source, tracker } = setup()
    let heard = 0
    const stop = tracker.subscribe(() => { heard += 1 })
    source.append(toolCall('a', 'read', { file_path: 'a.ts' }, 1))
    stop()
    source.append(toolCall('b', 'read', { file_path: 'a.ts' }, 1))
    expect(heard).toBe(1)
  })
})
