/**
 * Shared real-child suite for the `*.e2e.ts` backend files. Each file forces one `sandbox-local` rung,
 * probes it by confining and spawning `node -e 0`, and runs `read_document` through the real
 * `subprocess-local`, `fs-local`, `sandbox-policy`, `system-prompt`, and `tools` plugins.
 * Nothing here is faked: the child is `worker.ts` through tsx, or the built `lib/worker.js`.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { SandboxInternals } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SourceToolDocument from '../src/index.ts'
import type { Config as ToolDocumentConfig } from '../src/index.ts'
import { sampleDocx } from './fixtures/docx.ts'
import { emptyTextPdf, textPdf } from './fixtures/pdf.ts'
import { xlsxWithSheetData } from './fixtures/xlsx.ts'

/** One forced `sandbox-local` rung. */
export interface Backend {
  /** Display name used in the suite title. */
  name: string
  /** Rung forcing for `LocalSandboxProvider.internals`. */
  internals: SandboxInternals
  /** Platform gate checked before any spawn; a string is the skip reason. */
  gate?: () => string | undefined
  /** Whether the confined argv was produced by this rung. */
  isRunner: (confined: ConfinedArgv) => boolean
}

/**
 * Probe verdict. `reason` is the failure text when the rung cannot run `node -e 0`.
 * `sourceReason` is set when the rung runs Node but not the tsx loader the source child needs.
 */
export interface Probe {
  usable: boolean
  reason: string
  sourceReason?: string
}

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC_DIR = join(PACKAGE_ROOT, 'src')
const BUILT_INDEX = join(PACKAGE_ROOT, 'lib', 'index.js')
const BUILT_WORKER = join(PACKAGE_ROOT, 'lib', 'worker.js')

const DOCX_LINES = ['Hello & world', 'a < b', 'Bold line', 'tab\there', 'A\tB', 'C\t\tE', 'Before after']
const PDF_LINES = ['--- page 1 ---', 'Hello world', 'Next', '--- page 2 ---', 'Second page']
const XLSX_LINES = ['# Sheet', 'name\tqty', 'apple\t3', 'pear\t\tlate']

/**
 * Confine `node -e 0` read-only under the forced rung and run it, then do the same for one uncached tsx
 * transform, which is what a source-tree `read_document` child does first.
 * @param backend - the rung to force.
 * @returns usable when the confined child exits 0, else the error text the probe saw.
 */
export async function probeBackend(backend: Backend): Promise<Probe> {
  const gated = backend.gate?.()
  if (gated !== undefined) return { usable: false, reason: gated }
  const ctx = new Context()
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-document-probe-'))
  try {
    await ctx.plugin(LocalSandboxProvider, {})
    const sandbox = ctx.sandbox as LocalSandboxProvider
    sandbox.internals = backend.internals
    const run = async (argv: string[]): Promise<string | undefined> => {
      const confined = await sandbox.confine(argv, { mode: 'read-only', workspaceRoot: workspace })
      if (!backend.isRunner(confined)) return `another rung was selected: ${JSON.stringify(confined.argv)}`
      const [program, ...args] = confined.argv
      const result = spawnSync(program ?? '', args, { cwd: workspace, timeout: 30_000, encoding: 'utf8' })
      if (result.error !== undefined) return result.error.message
      if (result.status === 0) return undefined
      return failureLine(result.stderr) ?? `exit ${String(result.status)} signal ${String(result.signal)}`
    }
    const reason = await run([process.execPath, '-e', '0'])
    if (reason !== undefined) return { usable: false, reason }
    // tsx caches transforms in the temp directory, so a cached file would not show whether the
    // confined child may start esbuild. A file with unique content always needs a fresh transform.
    const fresh = join(workspace, 'probe.ts')
    await writeFile(fresh, `export const probe: string = ${JSON.stringify(randomUUID())}\n`)
    const transformed = await run([process.execPath, '--import', import.meta.resolve('tsx/esm'), fresh])
    const sourceReason = transformed === undefined ? undefined : `the confined child cannot run an uncached tsx transform: ${transformed}`
    return { usable: true, reason: '', ...sourceReason === undefined ? {} : { sourceReason } }
  } catch (error) {
    return { usable: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    await ctx.fiber.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
}

/** The first `...Error: ...` line of a Node stderr, else the whole trimmed text, else undefined. */
function failureLine(stderr: string): string | undefined {
  const text = stderr.trim()
  if (text.length === 0) return undefined
  return text.split(/\r?\n/u).find(line => /^\w*Error\b/u.test(line)) ?? text
}

/**
 * Whether `lib/` holds a usable build. tsdown writes `lib/index.js` and `lib/worker.js` together;
 * the build counts as stale when either is older than the newest file in `src/`, since then the
 * bundle may not contain the code the source tests just exercised.
 * @returns undefined when fresh, else the skip reason.
 */
export function builtLibSkipReason(): string | undefined {
  if (!existsSync(BUILT_INDEX) || !existsSync(BUILT_WORKER)) return 'lib/index.js or lib/worker.js is not built'
  const newestSource = Math.max(...readdirSync(SRC_DIR).map(name => statSync(join(SRC_DIR, name)).mtimeMs))
  const oldestBuilt = Math.min(statSync(BUILT_INDEX).mtimeMs, statSync(BUILT_WORKER).mtimeMs)
  if (oldestBuilt < newestSource) {
    return `lib/ is stale: built ${new Date(oldestBuilt).toISOString()}, src changed ${new Date(newestSource).toISOString()}`
  }
  return undefined
}

type ToolDocumentModule = typeof SourceToolDocument

interface Mounted {
  ctx: Context
  root: string
  confined: ConfinedArgv[]
}

interface ToolResult {
  isError?: boolean
  value?: unknown
  content: Array<{ type: string; text?: string }>
}

function resultText(result: ToolResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function lineTexts(result: ToolResult): string[] {
  const value = result.value as { lines?: Array<{ text: string }> } | undefined
  return (value?.lines ?? []).map(line => line.text)
}

/**
 * Register the real-child suite for one backend.
 * @param backend - the forced rung.
 * @param probe - the verdict from {@link probeBackend}, computed at module load.
 */
export function describeBackend(backend: Backend, probe: Probe): void {
  const title = probe.usable
    ? `tool-document: real ${backend.name} child`
    : `tool-document: real ${backend.name} child (skipped: ${probe.reason})`
  let mounted: Mounted | undefined

  afterEach(async () => {
    await mounted?.ctx.fiber.dispose()
    if (mounted !== undefined) await rm(mounted.root, { recursive: true, force: true })
    mounted = undefined
  })

  async function mount(config: ToolDocumentConfig = {}, plugin: ToolDocumentModule = SourceToolDocument): Promise<Mounted> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-document-e2e-'))
    const ctx = new Context()
    const confined: ConfinedArgv[] = []
    mounted = { ctx, root, confined }
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: root })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalSandboxProvider, {})
    const sandbox = ctx.sandbox as LocalSandboxProvider
    sandbox.internals = backend.internals
    const confine = sandbox.confine.bind(sandbox)
    sandbox.confine = async (...args) => {
      const wrapped = await confine(...args)
      confined.push(wrapped)
      return wrapped
    }
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(plugin, config)
    return mounted
  }

  async function read(target: Mounted, name: string, bytes: Uint8Array): Promise<ToolResult> {
    await writeFile(join(target.root, name), bytes)
    return await target.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`e2e-${name}`),
      name: 'read_document',
      arguments: { file_path: name },
    })
  }

  function expectChild(target: Mounted, worker: string): void {
    expect(target.confined).toHaveLength(1)
    const wrapped = target.confined[0]
    expect(wrapped !== undefined && backend.isRunner(wrapped)).toBe(true)
    expect(wrapped?.argv).toContain(worker)
  }

  const sourceWorker = join(SRC_DIR, 'worker.ts')

  const sourceTitle = probe.sourceReason === undefined
    ? 'source worker.ts through tsx'
    : `source worker.ts through tsx (skipped: ${probe.sourceReason})`

  describe.skipIf(!probe.usable)(title, () => {
    describe.skipIf(probe.sourceReason !== undefined)(sourceTitle, () => {
      it('extracts DOCX paragraphs and table rows', async () => {
        const target = await mount()
        const result = await read(target, 'report.docx', sampleDocx())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(DOCX_LINES)
        expect(result.value).toMatchObject({ format: 'docx', totalLines: DOCX_LINES.length, truncated: false })
        expect(resultText(result)).toContain('(End of document)')
        expectChild(target, sourceWorker)
      })

      it('extracts the PDF text layer with page markers', async () => {
        const target = await mount()
        const result = await read(target, 'paper.pdf', textPdf())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(PDF_LINES)
        expect(result.value).not.toHaveProperty('notice')
        expectChild(target, sourceWorker)
      })

      it('reports a PDF with no text layer', async () => {
        const target = await mount()
        const result = await read(target, 'scan.pdf', emptyTextPdf())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(result.value).toMatchObject({ format: 'pdf', lines: [], totalLines: 0, notice: 'This PDF has no text layer.' })
        expect(resultText(result)).toContain('This PDF has no text layer.')
      })

      it('extracts XLSX rows as tab-separated lines', async () => {
        const target = await mount()
        const bytes = xlsxWithSheetData([
          '<row r="1"><c r="A1" t="str"><v>name</v></c><c r="B1" t="str"><v>qty</v></c></row>',
          '<row r="2"><c r="A2" t="str"><v>apple</v></c><c r="B2"><v>3</v></c></row>',
          '<row r="3"><c r="A3" t="str"><v>pear</v></c><c r="C3" t="str"><v>late</v></c></row>',
        ].join(''))
        const result = await read(target, 'stock.xlsx', bytes)
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(XLSX_LINES)
        expectChild(target, sourceWorker)
      })

      it('stops at maxPages and says so', async () => {
        const target = await mount({ maxPages: 1 })
        const result = await read(target, 'paper.pdf', textPdf())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(PDF_LINES.slice(0, 3))
        expect(result.value).toMatchObject({ truncated: true, notice: 'Extraction stopped at maxPages (1 of 2 pages).' })
        expect(resultText(result)).toContain('Extraction stopped at maxPages (1 of 2 pages).')
      })
    })

    const builtSkip = builtLibSkipReason()
    const builtTitle = builtSkip === undefined ? 'built lib/worker.js' : `built lib/worker.js (skipped: ${builtSkip})`
    describe.skipIf(builtSkip !== undefined)(builtTitle, () => {
      async function mountBuilt(): Promise<Mounted> {
        return await mount({}, await import(pathToFileURL(BUILT_INDEX).href) as ToolDocumentModule)
      }

      it('extracts DOCX through the bundled worker', async () => {
        const target = await mountBuilt()
        const result = await read(target, 'report.docx', sampleDocx())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(DOCX_LINES)
        expectChild(target, BUILT_WORKER)
      })

      it('extracts the PDF text layer through the bundled worker', async () => {
        const target = await mountBuilt()
        const result = await read(target, 'paper.pdf', textPdf())
        expect(result.isError, resultText(result)).not.toBe(true)
        expect(lineTexts(result)).toEqual(PDF_LINES)
        expectChild(target, BUILT_WORKER)
      })
    })
  })
}
