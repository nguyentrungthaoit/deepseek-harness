/** Recognize the closing summary line of a vitest, jest, or pytest run in command output. */
import type { TestTally } from './contract/chat-nodes.ts'

type Bucket = keyof TestTally

/** Count words of the three runners, by the bucket they add to; other words are read and ignored. */
const BUCKETS: Readonly<Record<string, Bucket>> = {
  passed: 'passed',
  xpassed: 'passed',
  failed: 'failed',
  error: 'failed',
  errors: 'failed',
  skipped: 'skipped',
  xfailed: 'skipped',
  todo: 'skipped',
}

// SGR color sequences that runners emit when they believe stdout is a terminal.
const ANSI = /\u001b\[[0-9;]*m/g
/** vitest: `      Tests  2 failed | 128 passed | 5 skipped (135)` */
const VITEST = /^\s*Tests\s+(\d.*?)\s+\(\d+\)\s*$/
/** jest: `Tests:       2 failed, 1 skipped, 128 passed, 131 total` */
const JEST = /^\s*Tests:\s+(\d.*?\d+ total)\s*$/
/** pytest: `===== 2 failed, 128 passed, 5 skipped in 3.21s =====`, also without rules under `-q`. */
const PYTEST = /^[=\s]*(\d+ [a-z]+(?:, \d+ [a-z]+)*) in \d+(?:\.\d+)?s(?: \([\d:.]+\))?[=\s]*$/
const COUNT = /^(\d+) ([a-z][a-z ]*)$/

function tally(list: string, separator: string): TestTally | null {
  const counts = { passed: 0, failed: 0, skipped: 0 }
  let known = false
  for (const part of list.split(separator)) {
    const match = COUNT.exec(part.trim())
    if (match === null) return null
    const bucket = BUCKETS[match[2] as string]
    if (bucket === undefined) continue
    counts[bucket] += Number(match[1])
    known = true
  }
  return known ? counts : null
}

function lineTally(line: string): TestTally | null {
  const vitest = VITEST.exec(line)
  if (vitest !== null) return tally(vitest[1] as string, '|')
  const jest = JEST.exec(line)
  if (jest !== null) return tally(jest[1] as string, ',')
  const pytest = PYTEST.exec(line)
  return pytest === null ? null : tally(pytest[1] as string, ',')
}

/**
 * Read the counts of the last test-runner summary in command output.
 * @param text - command output, possibly with terminal color codes.
 * @returns the latest recognized summary, or null when the output contains none.
 */
export function parseTestTally(text: string): TestTally | null {
  const lines = text.replace(ANSI, '').split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const found = lineTally((lines[index] as string).replace(/\r$/, ''))
    if (found !== null) return found
  }
  return null
}
