/** Measured outcomes of settled Tool calls: line totals of file edits and the text of shell output. */
import { diffTotals, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffStat } from './contract/chat-nodes.ts'
import type { ToolArgs, ToolResultNode } from './contract/snapshot.ts'

/** Tool names whose results carry command output that may contain a test-runner summary. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh', 'job_output', 'terminal_read'])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHunk(value: unknown): value is DiffHunk {
  return isRecord(value)
    && typeof value.path === 'string'
    && (value.oldText === null || typeof value.oldText === 'string')
    && typeof value.newText === 'string'
}

/** Applied hunks from `write`/`edit` result metadata; null when absent or malformed. */
function appliedHunks(meta: unknown): DiffHunk[] | null {
  if (!isRecord(meta) || !Array.isArray(meta.diffs)) return null
  const hunks: DiffHunk[] = []
  for (const hunk of meta.diffs) {
    if (!isHunk(hunk)) return null
    hunks.push(hunk)
  }
  return hunks
}

/** Hunks a call applied, or null when its result does not determine them. */
function editHunks(name: string, args: ToolArgs, meta: unknown): DiffHunk[] | null {
  if (name === 'str_replace_editor') {
    const path = args.text('path')
    if (path === undefined) return null
    switch (args.text('command')) {
      case 'create': {
        const text = args.text('file_text')
        return text === undefined ? null : [{ path, oldText: null, newText: text }]
      }
      case 'str_replace': {
        const oldText = args.text('old_str')
        return oldText === undefined ? null : [{ path, oldText, newText: args.text('new_str') ?? '' }]
      }
      case 'insert': {
        const text = args.text('new_str')
        return text === undefined ? null : [{ path, oldText: null, newText: text }]
      }
      default:
        return null
    }
  }
  if (name !== 'write' && name !== 'edit') return null
  const applied = appliedHunks(meta)
  if (applied === null || applied.length > 0) return applied
  // Empty applied hunks mean a create or an identical overwrite; only a create adds lines.
  const path = args.text('file_path')
  const content = args.text('content')
  if (name !== 'write' || !isRecord(meta) || meta.operation !== 'create' || path === undefined || content === undefined) return null
  return [{ path, oldText: null, newText: content }]
}

/**
 * Measure the lines a successful file-editing call changed: applied `write`/`edit`
 * hunks from result metadata, a `write` create from its content, and
 * `str_replace_editor` create/str_replace/insert from its arguments.
 * @param name - wire Tool name.
 * @param args - the call's arguments.
 * @param meta - the result's opaque metadata.
 * @returns the totals, or null when the call is not a measurable edit or changed no lines.
 */
export function editDiffStat(name: string, args: ToolArgs, meta: unknown): DiffStat | null {
  const hunks = editHunks(name, args, meta)
  const first = hunks?.[0]
  if (hunks === null || first === undefined) return null
  const { added, removed } = diffTotals(hunks)
  return added === 0 && removed === 0 ? null : { path: first.path, added, removed }
}

/**
 * Tell whether a Tool's output is command output that may contain a test-runner summary.
 * @param name - wire Tool name.
 * @returns whether the result text should be scanned for test counts.
 */
export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.has(name)
}

/**
 * Join the text blocks of a Tool result.
 * @param content - result content blocks.
 * @returns the text, one block per line.
 */
export function resultText(content: ToolResultNode['content']): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text') text += `${text === '' ? '' : '\n'}${block.text}`
  }
  return text
}
