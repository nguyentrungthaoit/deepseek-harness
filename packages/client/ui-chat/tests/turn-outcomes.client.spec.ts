import { describe, expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ConversationMatch } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseTestTally } from '../src/client/test-tally.ts'
import { editDiffStat, isShellTool, resultText } from '../src/client/tool-outcome.ts'
import { liveOutcomes } from '../src/client/chat/live-turn.ts'
import { RainField, rainGlyphs, type RainPainter } from '../src/client/chat/reasoning-rain.ts'
import { turnReport } from '../src/client/conversation-nodes/turn-report.ts'
import type { ConversationNode, ToolResultNode } from '../src/client/contract/snapshot.ts'

const args = (value: Record<string, unknown>) => PartialArguments.fromObject(value)

describe('parseTestTally', () => {
  it('reads a failing vitest run with skipped and todo cases', () => {
    const output = [
      ' ❯ src/foo.spec.ts (3 tests | 1 failed) 12ms',
      '',
      ' Test Files  1 failed | 12 passed (13)',
      '      Tests  2 failed | 128 passed | 4 skipped | 1 todo (135)',
      '   Start at  10:02:11',
      '   Duration  3.21s (transform 1.1s, setup 0ms, collect 2.0s, tests 0.9s)',
    ].join('\n')
    expect(parseTestTally(output)).toEqual({ passed: 128, failed: 2, skipped: 5 })
  })

  it('reads a colored passing vitest run with CRLF line ends', () => {
    const output = '\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[90m (4)\u001b[39m\r\n'
      + '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m31 passed\u001b[39m\u001b[22m\u001b[90m (31)\u001b[39m\r\n'
    expect(parseTestTally(output)).toEqual({ passed: 31, failed: 0, skipped: 0 })
  })

  it('reads a jest summary', () => {
    const output = [
      'Test Suites: 1 failed, 2 passed, 3 total',
      'Tests:       2 failed, 1 skipped, 1 todo, 128 passed, 132 total',
      'Snapshots:   0 total',
      'Time:        2.317 s',
      'Ran all test suites.',
    ].join('\n')
    expect(parseTestTally(output)).toEqual({ passed: 128, failed: 2, skipped: 2 })
  })

  it('reads pytest summaries with rules, errors, expected failures, and long durations', () => {
    expect(parseTestTally('FAILED tests/test_a.py::test_x - assert 1 == 2\n'
      + '============ 2 failed, 128 passed, 5 skipped, 1 warning in 3.21s ============'))
      .toEqual({ passed: 128, failed: 2, skipped: 5 })
    expect(parseTestTally('======= 1 error, 3 passed, 2 xfailed, 1 xpassed in 75.20s (0:01:15) ======='))
      .toEqual({ passed: 4, failed: 1, skipped: 2 })
    expect(parseTestTally('12 passed, 2 errors in 0.52s')).toEqual({ passed: 12, failed: 2, skipped: 0 })
  })

  it('keeps the latest of several runs', () => {
    expect(parseTestTally('      Tests  3 failed | 1 passed (4)\n...\n      Tests  4 passed (4)'))
      .toEqual({ passed: 4, failed: 0, skipped: 0 })
  })

  it('shows nothing for unknown or countless output', () => {
    expect(parseTestTally('')).toBeNull()
    expect(parseTestTally('build ok\n[exit code: 0]')).toBeNull()
    expect(parseTestTally('==== 5 deselected in 0.01s ====')).toBeNull()
    expect(parseTestTally('      Tests  some passed (4)')).toBeNull()
    expect(parseTestTally('Tests:       2 failed, lots passed, 3 total')).toBeNull()
  })
})

describe('editDiffStat', () => {
  it('counts applied edit hunks, excluding shared context', () => {
    const meta = { diffs: [{ path: 'src/foo.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc\nd' }] }
    expect(editDiffStat('edit', args({ file_path: '/w/src/foo.ts' }), meta)).toEqual({ path: 'src/foo.ts', added: 2, removed: 1 })
  })

  it('counts a write create from its content and skips an identical overwrite', () => {
    const write = args({ file_path: 'new.ts', content: 'one\ntwo\n' })
    expect(editDiffStat('write', write, { diffs: [], operation: 'create' })).toEqual({ path: 'new.ts', added: 2, removed: 0 })
    expect(editDiffStat('write', write, { diffs: [], operation: 'update' })).toBeNull()
    expect(editDiffStat('edit', write, { diffs: [], operation: 'create' })).toBeNull()
    expect(editDiffStat('write', args({ file_path: 'new.ts' }), { diffs: [], operation: 'create' })).toBeNull()
    expect(editDiffStat('write', args({ content: 'x' }), { diffs: [], operation: 'create' })).toBeNull()
  })

  it('skips missing or malformed metadata', () => {
    const edit = args({ file_path: 'a.ts' })
    expect(editDiffStat('edit', edit, undefined)).toBeNull()
    expect(editDiffStat('edit', edit, [])).toBeNull()
    expect(editDiffStat('edit', edit, { diffs: 'x' })).toBeNull()
    expect(editDiffStat('edit', edit, { diffs: [{ path: 'a.ts', oldText: 1, newText: '' }] })).toBeNull()
    expect(editDiffStat('edit', edit, { diffs: [null] })).toBeNull()
    expect(editDiffStat('read', edit, { diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] })).toBeNull()
  })

  it('measures str_replace_editor create, replace, and insert from arguments', () => {
    expect(editDiffStat('str_replace_editor', args({ command: 'create', path: 'c.py', file_text: 'a\nb' }), undefined))
      .toEqual({ path: 'c.py', added: 2, removed: 0 })
    expect(editDiffStat('str_replace_editor', args({ command: 'str_replace', path: 'c.py', old_str: 'a\nb', new_str: 'c' }), undefined))
      .toEqual({ path: 'c.py', added: 1, removed: 2 })
    expect(editDiffStat('str_replace_editor', args({ command: 'str_replace', path: 'c.py', old_str: 'a' }), undefined))
      .toEqual({ path: 'c.py', added: 0, removed: 1 })
    expect(editDiffStat('str_replace_editor', args({ command: 'insert', path: 'c.py', insert_line: 2, new_str: 'z' }), undefined))
      .toEqual({ path: 'c.py', added: 1, removed: 0 })
  })

  it('skips str_replace_editor calls it cannot measure', () => {
    expect(editDiffStat('str_replace_editor', args({ command: 'view', path: 'c.py' }), undefined)).toBeNull()
    expect(editDiffStat('str_replace_editor', args({ command: 'create', file_text: 'a' }), undefined)).toBeNull()
    expect(editDiffStat('str_replace_editor', args({ command: 'create', path: 'c.py' }), undefined)).toBeNull()
    expect(editDiffStat('str_replace_editor', args({ command: 'str_replace', path: 'c.py' }), undefined)).toBeNull()
    expect(editDiffStat('str_replace_editor', args({ command: 'insert', path: 'c.py' }), undefined)).toBeNull()
    expect(editDiffStat('str_replace_editor', args({ command: 'str_replace', path: 'c.py', old_str: 'a', new_str: 'a' }), undefined)).toBeNull()
  })
})

describe('shell output', () => {
  it('recognizes shell tools and joins text blocks', () => {
    expect(isShellTool('bash')).toBe(true)
    expect(isShellTool('read')).toBe(false)
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image', attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 68, width: 1, height: 1 } }, { type: 'text', text: 'b' }]))
      .toBe('a\nb')
  })
})

function result(over: Partial<ToolResultNode> & Pick<ToolResultNode, 'callId' | 'name'>): ToolResultNode {
  return {
    kind: 'tool-result', seq: 1, time: 2_000, args: PartialArguments.EMPTY, call: null, callTime: 1_000,
    content: [], isError: false, subCalls: [], ...over,
  }
}

describe('liveOutcomes', () => {
  const editMeta = { diffs: [{ path: 'src/a.ts', oldText: null, newText: 'x' }] }
  it('lists measured root edits newest first and keeps the latest recognized test run', () => {
    const vitest = (passed: number) => [{ type: 'text' as const, text: `      Tests  ${passed} passed (${passed})` }]
    const nodes: ConversationNode[] = [
      result({ callId: 'old', name: 'edit', time: 500, meta: editMeta }),
      result({ callId: 'e1', name: 'edit', time: 2_000, meta: editMeta }),
      result({ callId: 't1', name: 'bash', time: 2_100, content: vitest(3) }),
      result({ callId: 'e2', name: 'edit', time: 2_200, meta: editMeta, isError: true }),
      result({ callId: 'e3', name: 'edit', time: 2_300, meta: editMeta, parentCallId: 'p' }),
      result({ callId: 'e4', name: 'edit', time: 2_400, meta: { diffs: [{ path: 'src/b.ts', oldText: 'a', newText: 'b' }] } }),
      result({ callId: 't2', name: 'bash', time: 2_500, content: vitest(7) }),
      result({ callId: 't3', name: 'bash', time: 2_600, content: [{ type: 'text', text: 'ls' }] }),
    ]
    const first = liveOutcomes(nodes, 1_000)
    expect(first).toEqual({
      edits: [{ callId: 'e4', path: 'src/b.ts', added: 1, removed: 1 }, { callId: 'e1', path: 'src/a.ts', added: 1, removed: 0 }],
      tests: { passed: 7, failed: 0, skipped: 0 },
    })
    expect(liveOutcomes(nodes, 1_000).edits[0]).toBe(first.edits[0])
  })

  it('shares one empty value when nothing was measured', () => {
    expect(liveOutcomes([], 0)).toBe(liveOutcomes([result({ callId: 'r', name: 'read' })], 0))
  })
})

describe('reasoning rain', () => {
  it('takes glyphs only from streaming reasoning', () => {
    expect(rainGlyphs(null)).toBe('')
    expect(rainGlyphs({ turn: 1, step: 1, blocks: [{ kind: 'text', text: 'hi' }] })).toBe('')
    expect(rainGlyphs({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'a b\nc' }] })).toBe('abc')
    expect(rainGlyphs({ turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'x'.repeat(500) }] })).toHaveLength(96)
  })

  it('drops glyphs down columns, fades older ones, and restarts columns below the band', () => {
    let seed = 0
    const field = new RainField(22, 22, () => { seed = (seed + 0.37) % 1; return seed })
    const drawn: Array<{ text: string; alpha: number; y: number }> = []
    const painter: RainPainter = {
      globalAlpha: 1,
      clearRect: () => {},
      fillText(text, _x, y) { drawn.push({ text, alpha: this.globalAlpha, y }) },
    }
    field.advance(0, 'ab')
    field.draw(painter)
    expect(drawn).toEqual([])
    field.advance(700, '')
    field.draw(painter)
    expect(drawn).toEqual([])
    for (let step = 0; step < 40; step++) {
      field.advance(60, 'ab')
      field.draw(painter)
    }
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.every(glyph => glyph.text === 'a' || glyph.text === 'b')).toBe(true)
    expect(Math.min(...drawn.map(glyph => glyph.alpha))).toBeLessThan(1)
    for (let step = 0; step < 400; step++) field.advance(100, 'ab')
    expect(new RainField(0, 22, () => 0.5)).toBeInstanceOf(RainField)
  })
})

let seq = 0
function at(time: number, type: string, data: Record<string, unknown>): ConversationMatch {
  seq++
  // The report reads only the event fields below; location is unused.
  return { event: { seq, time, type, data }, location: { kind: 'session' } } as ConversationMatch
}

function call(time: number, callId: string, name: string, argsValue: Record<string, unknown>): ConversationMatch {
  return at(time, 'tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(argsValue) })
}

function done(time: number, callId: string, text: string, meta?: unknown, isError?: boolean): ConversationMatch {
  return at(time, 'tool/result', {
    turn: 1, step: 1, meta,
    message: { role: 'tool', source: { callId }, content: [{ type: 'text', text }], ...isError === undefined ? {} : { isError } },
  })
}

describe('turnReport', () => {
  const start = at(0, 'turn/start', { turn: 1 })
  it('skips Turns shorter than the shortest threshold', () => {
    expect(turnReport(start, at(59_999, 'turn/end', { turn: 1 }), [])).toBeUndefined()
  })

  it('summarizes calls, distinct edited files, the latest test run, and the slowest call', () => {
    const editMeta = (path: string) => ({ diffs: [{ path, oldText: 'a', newText: 'b\nc' }] })
    const matches = [
      start,
      call(1_000, 'e1', 'edit', { file_path: 'a.ts' }), done(2_000, 'e1', 'ok', editMeta('a.ts')),
      call(3_000, 'e2', 'edit', { file_path: 'a.ts' }), done(4_000, 'e2', 'ok', editMeta('a.ts')),
      call(5_000, 'w1', 'write', { file_path: 'b.ts', content: 'x\ny' }), done(6_000, 'w1', 'ok', { diffs: [], operation: 'create' }),
      call(7_000, 'f1', 'edit', { file_path: 'c.ts' }), done(8_000, 'f1', 'boom', editMeta('c.ts'), true),
      call(9_000, 'b1', 'bash', { command: 'pnpm test' }), done(70_000, 'b1', '      Tests  1 failed | 9 passed (10)'),
      call(71_000, 'b2', 'bash', { command: 'ls' }), done(72_000, 'b2', 'a.ts'),
      call(73_000, 'r1', 'read', { file_path: 'a.ts' }), done(74_000, 'r1', 'text'),
      done(75_000, 'gone', 'orphan'),
      call(76_000, 'p1', 'bash', { command: 'sleep' }),
      at(130_000, 'turn/end', { turn: 1 }),
    ]
    expect(turnReport(start, matches.at(-1) as ConversationMatch, matches)).toEqual({
      durationMs: 130_000,
      toolCalls: 8,
      files: 2,
      added: 6,
      removed: 2,
      tests: { passed: 9, failed: 1, skipped: 0 },
      slowest: { name: 'bash', durationMs: 61_000 },
    })
  })

  it('reports no tests or slowest call for a Turn without settled calls', () => {
    const end = at(90_000, 'turn/end', { turn: 1 })
    expect(turnReport(start, end, [start, end])).toEqual({
      durationMs: 90_000, toolCalls: 0, files: 0, added: 0, removed: 0, tests: null, slowest: null,
    })
  })
})
