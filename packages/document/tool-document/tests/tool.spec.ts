/** `read_document` registration, windows, and child lifecycle. */
import { PassThrough, Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolDocument from '../src/index.ts'
import type { ChildRequest } from '../src/child.ts'

const ROOT = 'D:\\document-tool-root'
const OUTSIDE = 'D:\\outside\\attachments\\note.docx'

interface StoredFile {
  bytes: Uint8Array
  type?: 'file' | 'directory'
}

interface SpawnSpec {
  argv: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  graceMs: number
}

interface ConfinePolicy {
  mode: string
  workspaceRoot: string
  sessionId?: string
}

interface HandleControl {
  terminate(): void
  waitForExit(): Promise<boolean>
  readonly waited: boolean
}

function jsonHandle(payload: string, exitCode: number | null, stderr = ''): HandleControl & {
  stdin: PassThrough
  stdout: Readable
  collected: { stderr: { readFrom(from: number): { text: string; nextOffset: number; lossy: boolean } } }
  done: Promise<{ exitCode: number | null; signal: null }>
} {
  let waited = false
  let settle = (_outcome: { exitCode: number | null; signal: null }): void => {}
  const done = new Promise<{ exitCode: number | null; signal: null }>((resolve) => { settle = resolve })
  const stdout = Readable.from([Buffer.from(payload)])
  const control = {
    stdin: new PassThrough(),
    stdout,
    collected: { stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) } },
    done,
    terminate() { settle({ exitCode, signal: null }) },
    async waitForExit() {
      await done
      waited = true
      return true
    },
    get waited() { return waited },
  }
  settle({ exitCode, signal: null })
  return control
}

function hangHandle(): HandleControl & {
  stdin: PassThrough
  stdout: PassThrough
  collected: { stderr?: undefined }
  done: Promise<{ exitCode: null; signal: 'SIGTERM' }>
} {
  let waited = false
  let settle = (_outcome: { exitCode: null; signal: 'SIGTERM' }): void => {}
  const done = new Promise<{ exitCode: null; signal: 'SIGTERM' }>((resolve) => { settle = resolve })
  const stdout = new PassThrough()
  return {
    stdin: new PassThrough(),
    stdout,
    collected: {},
    done,
    terminate() {
      stdout.end()
      settle({ exitCode: null, signal: 'SIGTERM' })
    },
    async waitForExit() {
      await done
      await new Promise((resolve) => { setTimeout(resolve, 30) })
      waited = true
      return true
    },
    get waited() { return waited },
  }
}

async function setup(options?: {
  files?: Map<string, StoredFile>
  config?: Record<string, number>
  handles?: Array<ReturnType<typeof jsonHandle> | ReturnType<typeof hangHandle>>
  confine?: (argv: readonly string[], policy: ConfinePolicy) => Promise<{ argv: string[] }>
  policy?: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string; sessionId?: string }
}) {
  const files = options?.files ?? new Map<string, StoredFile>()
  const spawns: SpawnSpec[] = []
  const confines: ConfinePolicy[] = []
  const resolves: Array<{ path: string; cwd?: string }> = []
  let reads = 0
  const handles = [...(options?.handles ?? [])]
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('fs', {
    async resolve(path: string, resolveOptions?: { cwd?: string }) {
      resolves.push({ path, ...resolveOptions?.cwd === undefined ? {} : { cwd: resolveOptions.cwd } })
      const displayPath = path.includes(':') || path.startsWith('/') || path.startsWith('\\')
        ? path
        : `${resolveOptions?.cwd ?? ROOT}\\${path}`
      return { displayPath }
    },
    async stat(target: { displayPath: string }) {
      const file = files.get(target.displayPath)
      if (file === undefined) return undefined
      return { type: file.type ?? 'file' }
    },
    async readBytes(target: { displayPath: string }, _signal: AbortSignal | undefined, maxBytes: number) {
      reads += 1
      const file = files.get(target.displayPath)
      if (file === undefined) throw new FsError('missing', 'FS_NOT_FOUND')
      if (file.bytes.byteLength > maxBytes) {
        throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
      }
      return file.bytes
    },
  })
  ctx.provide('sandbox', {
    async confine(argv: readonly string[], policy: ConfinePolicy) {
      confines.push(policy)
      if (options?.confine !== undefined) return options.confine(argv, policy)
      return {
        argv: [...argv],
        enforcement: 'full' as const,
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  })
  ctx.provide('subprocess', {
    spawn(spec: SpawnSpec) {
      spawns.push(spec)
      const next = handles.shift()
      if (next === undefined) throw new Error('unexpected child spawn')
      return next
    },
  })
  ctx.provide('sandboxPolicy', {
    resolve: () => options?.policy ?? { mode: 'workspace-write' as const, workspaceRoot: ROOT },
  })
  const fiber = await ctx.plugin(ToolDocument, options?.config)
  return { ctx, fiber, spawns, confines, resolves, reads: () => reads }
}

function call(ctx: Context, args: unknown, signal = new AbortController().signal, agent?: object) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId('read-document'),
    name: 'read_document',
    arguments: args,
    ...agent === undefined ? {} : { agent: agent as never },
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function storedZip(names: readonly string[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const data = Buffer.from('x')
    const nameBuf = Buffer.from(name)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, eocd])
}

describe('registration', () => {
  it('registers read_document and removes it when the fiber disposes', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['read_document'])
    expect(ctx.tools.schemas()[0]?.description).toContain('read rejects binary')
    expect(ctx.tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('parallel'),
      name: 'read_document',
      arguments: { file_path: 'a.docx' },
    })).toEqual({ kind: 'parallel' })
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('rejects a non-positive cap at load', async () => {
    await expect(setup({ config: { limit: 0 } })).rejects.toThrow('tool-document: limit must be a positive integer')
    await expect(setup({ config: { limit: 1.5 } })).rejects.toThrow('tool-document: limit must be a positive integer')
    await expect(setup({ config: { timeoutMs: 2_147_483_648 } })).rejects.toThrow('no greater than 2147483647')
  })
})

describe('read_document', () => {
  it('returns a line window for an absolute docx path and scrubs the child env', async () => {
    const previous = process.env.DOCUMENT_PROBE_KEY
    process.env.DOCUMENT_PROBE_KEY = 'super-secret-value'
    process.env.PLAIN_VALUE = 'kept'
    try {
      const bytes = storedZip(['word/document.xml'])
      const handle = jsonHandle(JSON.stringify({ text: 'Hello\r\nWorld' }), 0)
      const { ctx, spawns, confines, resolves } = await setup({
        files: new Map([[OUTSIDE, { bytes }]]),
        policy: { mode: 'workspace-write', workspaceRoot: ROOT, sessionId: 'sess-1' },
        handles: [handle],
      })
      const result = await call(ctx, { file_path: OUTSIDE }, undefined, {
        session: { header: { cwd: 'D:\\sessions\\workspace' } },
      })
      expect(result.isError).toBe(false)
      if (result.isError) return
      expect(result.value).toMatchObject({
        path: OUTSIDE,
        format: 'docx',
        offset: 1,
        lines: [{ number: 1, text: 'Hello' }, { number: 2, text: 'World' }],
        totalLines: 2,
        truncated: false,
      })
      expect(result.value).not.toHaveProperty('notice')
      expect(text(result)).toContain('(End of document)')
      expect(text(result)).toContain('format="docx"')
      expect(resolves[0]).toEqual({ path: OUTSIDE, cwd: 'D:\\sessions\\workspace' })
      expect(confines[0]).toMatchObject({ mode: 'read-only', workspaceRoot: ROOT, sessionId: 'sess-1' })
      expect(spawns[0]?.cwd).toBe(ROOT)
      expect(spawns[0]?.env).not.toHaveProperty('DOCUMENT_PROBE_KEY')
      expect(spawns[0]?.env?.PLAIN_VALUE).toBe('kept')
      expect(JSON.stringify(spawns[0]?.env)).not.toContain('super-secret-value')
      const request = JSON.parse(spawns[0]?.argv.at(-1) ?? '') as ChildRequest
      expect(request.format).toBe('docx')
      expect(spawns[0]?.argv.join('\n')).not.toContain(OUTSIDE)
      expect(handle.waited).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DOCUMENT_PROBE_KEY
      else process.env.DOCUMENT_PROBE_KEY = previous
      delete process.env.PLAIN_VALUE
    }
  })

  it('passes a PDF notice through and does not reject a non-zip before spawn', async () => {
    const handle = jsonHandle(JSON.stringify({ text: '', notice: 'This PDF has no text layer. Scanned pages were not read.' }), 0)
    let sent = false
    handle.stdout = new Readable({
      objectMode: true,
      read() {
        if (sent) return
        sent = true
        this.push(JSON.stringify({ text: '', notice: 'This PDF has no text layer. Scanned pages were not read.' }))
        this.push(null)
      },
    })
    const { ctx, spawns, resolves } = await setup({
      files: new Map([['D:\\SCAN.PDF', { bytes: Buffer.from('%PDF-not-a-zip') }]]),
      config: { maxArchiveEntries: 1 },
      handles: [handle],
    })
    const result = await call(ctx, { file_path: 'D:\\SCAN.PDF' })
    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({
      format: 'pdf',
      lines: [],
      totalLines: 0,
      truncated: false,
      notice: 'This PDF has no text layer. Scanned pages were not read.',
    })
    expect(text(result)).toContain('This PDF has no text layer')
    expect(resolves[0]).toEqual({ path: 'D:\\SCAN.PDF' })
    expect(spawns).toHaveLength(1)
  })

  it('windows with offset, limit, line length, and the byte cap', async () => {
    const files = new Map([['D:\\sheet.xlsx', { bytes: storedZip(['xl/workbook.xml']) }]])
    const first = jsonHandle(JSON.stringify({ text: 'abcdef\nsecond' }), 0)
    const { ctx } = await setup({
      files,
      config: { maxLineLength: 3, limit: 1, maxBytes: 50 },
      handles: [first],
    })
    const limited = await call(ctx, { file_path: 'D:\\sheet.xlsx' })
    expect(limited.isError).toBe(false)
    if (limited.isError) return
    expect(limited.value).toMatchObject({
      format: 'xlsx',
      lines: [{ number: 1, text: 'abc... (line truncated to 3 chars)' }],
      totalLines: 2,
      truncated: true,
    })
    expect(text(limited)).toContain('Use offset=2')

    const second = jsonHandle(JSON.stringify({ text: 'one\ntwo' }), 0)
    const again = await setup({ files, handles: [second] })
    const offset = await call(again.ctx, { file_path: 'D:\\sheet.xlsx', offset: 2, limit: 5 })
    expect(offset.isError).toBe(false)
    if (offset.isError) return
    expect(offset.value).toMatchObject({
      offset: 2,
      lines: [{ number: 2, text: 'two' }],
      totalLines: 2,
      truncated: true,
    })
    expect(text(offset)).toContain('not fully returned')

    const third = jsonHandle(JSON.stringify({ text: 'hello' }), 0)
    const capped = await setup({ files, config: { maxBytes: 4 }, handles: [third] })
    const bytes = await call(capped.ctx, { file_path: 'D:\\sheet.xlsx' })
    expect(bytes.isError).toBe(false)
    if (bytes.isError) return
    expect(bytes.value).toMatchObject({ lines: [], totalLines: 1, truncated: true })
  })

  it('rejects the wrong extension, a missing file, a directory, a past-the-end offset, and an over-cap file', async () => {
    const files = new Map<string, StoredFile>([
      ['D:\\notes.txt', { bytes: Buffer.from('text') }],
      ['D:\\noext', { bytes: Buffer.from('text') }],
      ['D:\\dir.docx', { bytes: Buffer.from(''), type: 'directory' }],
      ['D:\\big.pdf', { bytes: Buffer.from('0123456789') }],
      ['D:\\short.pdf', { bytes: Buffer.from('%PDF') }],
    ])
    const handle = jsonHandle(JSON.stringify({ text: 'only' }), 0)
    const { ctx, reads, spawns } = await setup({ files, config: { maxInputBytes: 4 }, handles: [handle] })
    const wrong = await call(ctx, { file_path: 'D:\\notes.txt' })
    expect(wrong.isError).toBe(true)
    expect(text(wrong)).toContain('only .docx, .pdf, and .xlsx')
    const bare = await call(ctx, { file_path: 'D:\\noext' })
    expect(text(bare)).toContain('only .docx, .pdf, and .xlsx')
    expect(reads()).toBe(0)

    const missing = await call(ctx, { file_path: 'D:\\missing.docx' })
    expect(missing.isError).toBe(true)
    expect(missing.error?.info?.code).toBe('FS_NOT_FOUND')

    const directory = await call(ctx, { file_path: 'D:\\dir.docx' })
    expect(directory.isError).toBe(true)
    expect(directory.error?.info?.code).toBe('FS_NOT_REGULAR_FILE')

    const empty = await call(ctx, { file_path: '   ' })
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('non-empty')

    const huge = await call(ctx, { file_path: 'D:\\big.pdf' })
    expect(huge.isError).toBe(true)
    expect(huge.error?.info?.code).toBe('FS_TOO_LARGE')
    expect(spawns).toHaveLength(0)

    const badOffset = await call(ctx, { file_path: 'D:\\short.pdf', offset: 0 })
    expect(text(badOffset)).toContain('offset must be a positive integer')
    const bigLimit = await call(ctx, { file_path: 'D:\\short.pdf', limit: 5000 })
    expect(text(bigLimit)).toContain('less than or equal to 2000')

    const past = await call(ctx, { file_path: 'D:\\short.pdf', offset: 4 })
    expect(past.isError).toBe(true)
    expect(text(past)).toContain('out of range')

    const badLimit = await call(ctx, { file_path: 'D:\\short.pdf', limit: 0 })
    expect(badLimit.isError).toBe(true)
    expect(text(badLimit)).toContain('limit must be a positive integer')
  })

  it('rejects an archive that exceeds the entry cap before spawn', async () => {
    const { ctx, spawns } = await setup({
      files: new Map([['D:\\wide.docx', { bytes: storedZip(['a.xml', 'b.xml']) }]]),
      config: { maxArchiveEntries: 1 },
    })
    const result = await call(ctx, { file_path: 'D:\\wide.docx' })
    expect(result.isError).toBe(true)
    expect(spawns).toHaveLength(0)
  })

  it('turns a child crash into a tool error and still runs a later call', async () => {
    const files = new Map([['D:\\crash.pdf', { bytes: Buffer.from('%PDF') }]])
    const crashed = jsonHandle('', 1, 'parser exploded')
    const recovered = jsonHandle(JSON.stringify({ text: 'after' }), 0)
    const { ctx } = await setup({ files, handles: [crashed, recovered] })
    const first = await call(ctx, { file_path: 'D:\\crash.pdf' })
    expect(first.isError).toBe(true)
    expect(text(first)).toContain('parser exploded')
    const second = await call(ctx, { file_path: 'D:\\crash.pdf' })
    expect(second.isError).toBe(false)
    if (second.isError) return
    expect(second.value).toMatchObject({ lines: [{ number: 1, text: 'after' }] })
  })

  it('reports an exit code and a stopped child', async () => {
    const files = new Map([['D:\\bad.pdf', { bytes: Buffer.from('%PDF') }]])
    const coded = jsonHandle('', 2, '   ')
    const stopped = jsonHandle('', null, '')
    const { ctx } = await setup({ files, handles: [coded, stopped] })
    const exit = await call(ctx, { file_path: 'D:\\bad.pdf' })
    expect(text(exit)).toContain('exit code 2')
    const halted = await call(ctx, { file_path: 'D:\\bad.pdf' })
    expect(text(halted)).toContain('was stopped')
  })

  it('kills a child that exceeds the deadline and awaits exit', async () => {
    const handle = hangHandle()
    const { ctx } = await setup({
      files: new Map([['D:\\slow.pdf', { bytes: Buffer.from('%PDF') }]]),
      config: { timeoutMs: 40 },
      handles: [handle],
    })
    const result = await call(ctx, { file_path: 'D:\\slow.pdf' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('timed out')
    expect(handle.waited).toBe(true)
  })

  it('kills the child when the caller aborts', async () => {
    const handle = hangHandle()
    let spawned!: () => void
    const spawnedPromise = new Promise<void>((resolve) => { spawned = resolve })
    const { ctx } = await setup({
      files: new Map([['D:\\slow.pdf', { bytes: Buffer.from('%PDF') }]]),
      handles: [handle],
    })
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = (spec) => {
      const child = original(spec)
      spawned()
      return child
    }
    const controller = new AbortController()
    const pending = call(ctx, { file_path: 'D:\\slow.pdf' }, controller.signal)
    await spawnedPromise
    controller.abort(new Error('stop reading'))
    const result = await pending
    expect(text(result)).toContain('stop reading')
    expect(handle.waited).toBe(true)

    const stringAbort = new AbortController()
    stringAbort.abort('stop')
    const already = await call(ctx, { file_path: 'D:\\slow.pdf' }, stringAbort.signal)
    expect(already.isError).toBe(true)
    expect(text(already)).toContain('aborted')
  })

  it('aborts when confinement itself is cancelled and does not spawn', async () => {
    const controller = new AbortController()
    const { ctx, spawns } = await setup({
      files: new Map([['D:\\note.pdf', { bytes: Buffer.from('%PDF') }]]),
      confine: async (argv) => {
        controller.abort(new Error('during confine'))
        return { argv: [...argv], enforcement: 'full' as const, denialSignatures: [], runnerFailureRules: [] }
      },
    })
    const result = await call(ctx, { file_path: 'D:\\note.pdf' }, controller.signal)
    expect(text(result)).toContain('during confine')
    expect(spawns).toHaveLength(0)
  })

  it('fails closed when the sandbox is unavailable and does not spawn', async () => {
    const { ctx, spawns } = await setup({
      files: new Map([['D:\\note.pdf', { bytes: Buffer.from('%PDF') }]]),
      confine: () => Promise.reject(new SandboxUnavailableError('read-only')),
    })
    const result = await call(ctx, { file_path: 'D:\\note.pdf' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SANDBOX_UNAVAILABLE')
    expect(spawns).toHaveLength(0)
  })

  it('stops an in-flight child when the fiber disposes and waits for exit', async () => {
    const handle = hangHandle()
    let spawned!: () => void
    const spawnedPromise = new Promise<void>((resolve) => { spawned = resolve })
    const { ctx, fiber } = await setup({
      files: new Map([['D:\\slow.pdf', { bytes: Buffer.from('%PDF') }]]),
      handles: [handle],
    })
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = (spec) => {
      const child = original(spec)
      spawned()
      return child
    }
    const pending = call(ctx, { file_path: 'D:\\slow.pdf' })
    await spawnedPromise
    await fiber.dispose()
    expect(handle.waited).toBe(true)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('rejects a child that was started without pipes or that writes too much', async () => {
    const files = new Map([['D:\\note.pdf', { bytes: Buffer.from('%PDF') }]])
    const noStdin = jsonHandle('{"text":"x"}', 0)
    Object.assign(noStdin, { stdin: undefined })
    const noStdout = jsonHandle('{"text":"x"}', 0)
    Object.assign(noStdout, { stdout: undefined })
    const broken = jsonHandle('{"text":"x"}', 0)
    broken.stdin.on('error', () => {
      // destroy() emits on the next turn, before the tool call.
    })
    broken.stdin.destroy(new Error('stdin broken'))
    const noisy = new PassThrough()
    const huge = jsonHandle('', 0)
    Object.assign(huge, { stdout: noisy })
    setImmediate(() => { noisy.end(Buffer.alloc(4_000, 0x61)) })
    const { ctx } = await setup({
      files,
      config: { maxExtractedChars: 1 },
      handles: [noStdin, noStdout, broken, huge],
    })
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('without pipes')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('without pipes')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('stdin broken')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('byte cap')
  })
})
