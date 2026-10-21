/** `read_document` registration, windows, and child lifecycle. */
import { PassThrough, Readable, Writable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { childEnv } from '@deepseek-ai/dsh-subprocess-local/src/spawn.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolDocument from '../src/index.ts'
import type { ChildRequest } from '../src/extract.ts'

const ROOT = 'D:\\document-tool-root'
const OUTSIDE = 'D:\\outside\\attachments\\note.docx'

interface StoredFile {
  bytes: Uint8Array
  type?: 'file' | 'directory'
  version?: string
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

function manualHandle(): HandleControl & {
  stdin: PassThrough
  stdout: PassThrough
  collected: { stderr?: undefined }
  done: Promise<{ exitCode: number | null; signal: 'SIGTERM' | null }>
  finish(payload: string): void
  readonly terminated: boolean
} {
  let waited = false
  let terminated = false
  let settled = false
  let settle = (_outcome: { exitCode: number | null; signal: 'SIGTERM' | null }): void => {}
  const done = new Promise<{ exitCode: number | null; signal: 'SIGTERM' | null }>((resolve) => { settle = resolve })
  const stdout = new PassThrough()
  const end = (outcome: { exitCode: number | null; signal: 'SIGTERM' | null }): void => {
    if (settled) return
    settled = true
    settle(outcome)
  }
  return {
    stdin: new PassThrough(),
    stdout,
    collected: {},
    done,
    finish(payload) {
      stdout.end(payload)
      end({ exitCode: 0, signal: null })
    },
    terminate() {
      if (!settled) terminated = true
      stdout.end()
      end({ exitCode: null, signal: 'SIGTERM' })
    },
    async waitForExit() {
      await done
      waited = true
      return true
    },
    get waited() { return waited },
    get terminated() { return terminated },
  }
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !check(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
  expect(check()).toBe(true)
}

function result(payload: object): string {
  return JSON.stringify(payload)
}

async function setup(options?: {
  files?: Map<string, StoredFile>
  config?: Record<string, number>
  handles?: Array<ReturnType<typeof jsonHandle> | ReturnType<typeof hangHandle> | ReturnType<typeof manualHandle>>
  confine?: (argv: readonly string[], policy: ConfinePolicy) => Promise<{ argv: string[] }>
  policy?: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string; sessionId?: string }
  onStat?: (path: string) => 'missing' | undefined
  onRead?: (path: string) => Promise<void> | void
  targetKey?: (displayPath: string) => string
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
      return { targetKey: options?.targetKey?.(displayPath) ?? `key:${displayPath}`, displayPath }
    },
    async stat(target: { displayPath: string }) {
      const file = files.get(target.displayPath)
      if (file === undefined || options?.onStat?.(target.displayPath) === 'missing') return undefined
      return { type: file.type ?? 'file', version: FsVersion(file.version ?? 'v1'), size: file.bytes.byteLength }
    },
    async readBytes(target: { displayPath: string }, _signal: AbortSignal | undefined, maxBytes: number) {
      reads += 1
      await options?.onRead?.(target.displayPath)
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
  it('returns a line window for an absolute docx path and leaves the child env to the service scrub', async () => {
    const previous = process.env.DOCUMENT_PROBE_KEY
    const previousDsh = process.env.DSH_DOCUMENT_PROBE
    process.env.DOCUMENT_PROBE_KEY = 'super-secret-value'
    process.env.DSH_DOCUMENT_PROBE = 'harness-fact'
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
      // No explicit env: an explicit entry would merge after the service scrub and re-add what it removed.
      expect(spawns[0]?.env).toBeUndefined()
      const childEnvironment = childEnv(spawns[0]?.env)
      expect(childEnvironment).not.toHaveProperty('DOCUMENT_PROBE_KEY')
      expect(childEnvironment).not.toHaveProperty('DSH_DOCUMENT_PROBE')
      expect(childEnvironment.PLAIN_VALUE).toBe('kept')
      expect(JSON.stringify(childEnvironment)).not.toContain('super-secret-value')
      expect(JSON.stringify(childEnvironment)).not.toContain('harness-fact')
      const request = JSON.parse(spawns[0]?.argv.at(-1) ?? '') as ChildRequest
      expect(request.format).toBe('docx')
      expect(spawns[0]?.argv.join('\n')).not.toContain(OUTSIDE)
      expect(handle.waited).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DOCUMENT_PROBE_KEY
      else process.env.DOCUMENT_PROBE_KEY = previous
      if (previousDsh === undefined) delete process.env.DSH_DOCUMENT_PROBE
      else process.env.DSH_DOCUMENT_PROBE = previousDsh
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
    // Reading on with offset up to the last line has returned everything that remained.
    expect(offset.value).toMatchObject({
      offset: 2,
      lines: [{ number: 2, text: 'two' }],
      totalLines: 2,
      truncated: false,
    })
    expect(text(offset)).toContain('2|two\n(End of document)')
    expect(text(offset)).not.toContain('Extraction stopped early')

    const third = jsonHandle(JSON.stringify({ text: 'hello\nnext' }), 0)
    const capped = await setup({ files, config: { maxBytes: 4 }, handles: [third] })
    const bytes = await call(capped.ctx, { file_path: 'D:\\sheet.xlsx' })
    expect(bytes.isError).toBe(false)
    if (bytes.isError) return
    // The marker does not fit in 4 bytes, so the first line is cut to the cap without it.
    expect(bytes.value).toMatchObject({ lines: [{ number: 1, text: 'hell' }], totalLines: 2, truncated: true })
    expect(text(bytes)).toContain('Showing lines 1-1 of 2. Use offset=2 to continue.')
  })

  it('always returns the first selected line, cut on a UTF-8 boundary, when it alone exceeds the byte cap', async () => {
    const files = new Map([['D:\\wide.docx', { bytes: storedZip(['word/document.xml']) }]])
    const read = async (raw: string, config: Record<string, number>, offset?: number) => {
      const { ctx } = await setup({ files, config, handles: [jsonHandle(JSON.stringify({ text: raw }), 0)] })
      const value = await call(ctx, { file_path: 'D:\\wide.docx', ...offset === undefined ? {} : { offset } })
      expect(value.isError).toBe(false)
      if (value.isError) throw new Error('unexpected error result')
      return value
    }
    // 1 ASCII byte then two-byte characters: an 8-byte budget ends inside the fourth character.
    const cut = await read(`skip\na${'é'.repeat(20)}\nnext`, { maxBytes: 40 }, 2)
    expect(cut.value).toMatchObject({ offset: 2, lines: [{ number: 2, text: 'aééé... (line truncated to 40 bytes)' }], truncated: true })
    expect(Buffer.byteLength('aééé... (line truncated to 40 bytes)')).toBeLessThanOrEqual(40)
    expect(text(cut)).toContain('Showing lines 2-2 of 3. Use offset=3 to continue.')
    // A later line that does not fit is left for the next call, not cut.
    const later = await read('aa\nbbbbbbbb', { maxBytes: 5 })
    expect(later.value).toMatchObject({ lines: [{ number: 1, text: 'aa' }], totalLines: 2, truncated: true })
    expect(text(later)).toContain('Use offset=2 to continue.')
    // A one-byte budget cannot hold a two-byte character, so only the marker remains.
    const marker = await read('é'.repeat(20), { maxBytes: 33 })
    expect(marker.value).toMatchObject({ lines: [{ number: 1, text: '... (line truncated to 33 bytes)' }], totalLines: 1 })
    // The character cap applies first; when the marker cannot fit, the cut line is returned whole.
    const short = await read('abcdef', { maxLineLength: 3, maxBytes: 10 })
    expect(short.value).toMatchObject({ lines: [{ number: 1, text: 'abc' }], totalLines: 1, truncated: false })
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
    // The caller leaves at once; the shared extraction it was the last waiter on stops the child and awaits exit.
    await until(() => handle.waited)

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
    expect(text(result)).toContain('read_document cannot run because no sandbox is available on this host; do not retry')
    expect(text(result)).not.toContain('bubblewrap')
    expect(spawns).toHaveLength(0)
  })

  it('passes any other confinement failure through unchanged', async () => {
    const { ctx, spawns } = await setup({
      files: new Map([['D:\\note.pdf', { bytes: Buffer.from('%PDF') }]]),
      confine: () => Promise.reject(new Error('policy store offline')),
    })
    const result = await call(ctx, { file_path: 'D:\\note.pdf' })
    expect(text(result)).toContain('policy store offline')
    expect(text(result)).not.toContain('no sandbox')
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

  it('reports stdin and stdout failures and a failed child without a stderr tail', async () => {
    const files = new Map([['D:\\note.pdf', { bytes: Buffer.from('%PDF') }]])
    const writeFails = jsonHandle('{"text":"x"}', 0)
    Object.assign(writeFails, {
      stdin: new Writable({ write(_chunk, _encoding, callback) { callback(new Error('EPIPE child gone')) } }),
    })
    const stringFailure = jsonHandle('', 0)
    Object.assign(stringFailure, {
      stdout: new Readable({ read() { this.destroy('stdout gone' as unknown as Error) } }),
    })
    const closesStdin = jsonHandle('', 0)
    Object.assign(closesStdin, {
      stdout: new Readable({ read() { this.destroy(new Error('stdout read failed')) } }),
      terminate() { closesStdin.stdin.destroy(new Error('stdin closed by stop')) },
    })
    closesStdin.stdin.on('error', () => {
      // Observed through stdin.errored before this event is emitted.
    })
    const silent = jsonHandle('', 1)
    Object.assign(silent, { collected: {} })
    const { ctx } = await setup({ files, handles: [writeFails, stringFailure, closesStdin, silent] })
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('EPIPE child gone')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('stdout gone')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('stdin closed by stop')
    expect(text(await call(ctx, { file_path: 'D:\\note.pdf' }))).toContain('exit code 1')
  })

  it('drops one trailing newline and reads newline-only text as empty', async () => {
    const files = new Map([['D:\\a.pdf', { bytes: Buffer.from('%PDF') }], ['D:\\b.pdf', { bytes: Buffer.from('%PDF!') }]])
    const { ctx } = await setup({
      files,
      handles: [jsonHandle(result({ text: 'x\r\n' }), 0), jsonHandle(result({ text: '\r' }), 0)],
    })
    const trailing = await call(ctx, { file_path: 'D:\\a.pdf' })
    const blank = await call(ctx, { file_path: 'D:\\b.pdf' })
    expect(trailing.isError || blank.isError).toBe(false)
    if (trailing.isError || blank.isError) return
    expect(trailing.value).toMatchObject({ lines: [{ number: 1, text: 'x' }], totalLines: 1, truncated: false })
    expect(blank.value).toMatchObject({ lines: [], totalLines: 0, truncated: false })
  })
})

describe('prompt guidance', () => {
  it('adds read_document guidance only while the tool is visible and removes it on dispose', async () => {
    const { ctx, fiber } = await setup()
    const section = async () => (await ctx.systemPrompt.assemble()).sections.find(entry => entry.name === 'tool:read_document')
    expect((await section())?.text).toBe('Use read_document, not read, for .docx, .pdf, and .xlsx files. Use offset to continue reading a long document.')
    const original = ctx.tools.get.bind(ctx.tools)
    ctx.tools.get = (name, scope) => name === 'read_document' ? undefined : original(name, scope)
    try {
      expect((await section())?.text).toBe('')
    } finally {
      ctx.tools.get = original
    }
    await fiber.dispose()
    expect(await section()).toBeUndefined()
  })
})

describe('cap notices', () => {
  const PDF = new Map([['D:\\scan.pdf', { bytes: Buffer.from('%PDF') }]])

  it('appends the page cap to the no-text notice and marks the result truncated', async () => {
    const handle = jsonHandle(result({ text: '', notice: 'This PDF has no text layer.', capped: ['pages'], pageCount: 212 }), 0)
    const { ctx } = await setup({ files: PDF, handles: [handle] })
    const read = await call(ctx, { file_path: 'D:\\scan.pdf' })
    expect(read.isError).toBe(false)
    if (read.isError) return
    expect(read.value).toMatchObject({
      lines: [],
      truncated: true,
      notice: 'This PDF has no text layer. Extraction stopped at maxPages (50 of 212 pages).',
    })
    expect(text(read)).not.toContain('(End of document)')
    expect(text(read)).not.toContain('line 0')
    expect(text(read)).toContain('Extraction stopped at maxPages (50 of 212 pages).\n(Extraction stopped early and returned no text. See the notice above.)')
  })

  it('reports sheet, row, and character caps in one notice with their numbers', async () => {
    const handle = jsonHandle(result({ text: 'a\nb', capped: ['sheets', 'rows', 'chars'], sheetCount: 40, rowsSheet: 'Data' }), 0)
    const { ctx } = await setup({ files: PDF, handles: [handle] })
    const read = await call(ctx, { file_path: 'D:\\scan.pdf' })
    expect(read.isError).toBe(false)
    if (read.isError) return
    expect(read.value).toMatchObject({
      lines: [{ number: 1, text: 'a' }, { number: 2, text: 'b' }],
      totalLines: 2,
      truncated: true,
      notice: [
        'Extraction stopped at maxSheets (32 of 40 sheets).',
        'Extraction stopped at maxRowsPerSheet (5000 rows per sheet, first in sheet "Data").',
        'Extraction stopped at maxExtractedChars (1000000 characters).',
      ].join(' '),
    })
    expect(text(read)).toContain('2|b\n(End of extracted text at line 2. Extraction stopped early, so the document continues past it. See the notice above.)')
    expect(text(read)).not.toContain('offset=')
  })

  it('omits counts the child did not report', async () => {
    const handle = jsonHandle(result({ text: 'x', capped: ['pages', 'sheets', 'rows'] }), 0)
    const { ctx } = await setup({ files: PDF, config: { maxPages: 3, maxSheets: 2, maxRowsPerSheet: 7 }, handles: [handle] })
    const read = await call(ctx, { file_path: 'D:\\scan.pdf' })
    expect(read.isError).toBe(false)
    if (read.isError) return
    expect(read.value).toMatchObject({ notice: [
      'Extraction stopped at maxPages (3 pages).',
      'Extraction stopped at maxSheets (2 sheets).',
      'Extraction stopped at maxRowsPerSheet (7 rows per sheet).',
    ].join(' ') })
  })

  it('rejects a child result with an unknown cap', async () => {
    const handle = jsonHandle(result({ text: 'x', capped: ['lines'] }), 0)
    const { ctx } = await setup({ files: PDF, handles: [handle] })
    expect(text(await call(ctx, { file_path: 'D:\\scan.pdf' }))).toContain('unexpected result')
  })
})

describe('child limits', () => {
  it('caps the child heap, uses a fixed grace period, and reports an out-of-memory child', async () => {
    const files = new Map([['D:\\big.pdf', { bytes: Buffer.from('%PDF') }]])
    const oom = jsonHandle('', 134, '<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n 1: 0x1 node::Abort()')
    const { ctx, spawns } = await setup({ files, handles: [oom] })
    const read = await call(ctx, { file_path: 'D:\\big.pdf' })
    expect(read.isError).toBe(true)
    expect(text(read)).toContain('read_document ran out of memory; the file is too large to extract')
    expect(text(read)).not.toContain('FATAL')
    expect(text(read)).not.toContain('node::Abort')
    expect(spawns[0]?.argv).toContain('--max-old-space-size=1024')
    expect(spawns[0]?.graceMs).toBe(2000)

    const small = await setup({ files, config: { maxHeapMb: 256, timeoutMs: 60_000 }, handles: [jsonHandle(result({ text: 'ok' }), 0)] })
    expect((await call(small.ctx, { file_path: 'D:\\big.pdf' })).isError).toBe(false)
    expect(small.spawns[0]?.argv).toContain('--max-old-space-size=256')
    expect(small.spawns[0]?.graceMs).toBe(2000)
  })

  it('rejects non-positive queue and heap caps at load', async () => {
    await expect(setup({ config: { maxConcurrent: 0 } })).rejects.toThrow('maxConcurrent must be a positive integer')
    await expect(setup({ config: { maxQueued: 0 } })).rejects.toThrow('maxQueued must be a positive integer')
    await expect(setup({ config: { maxHeapMb: 0.5 } })).rejects.toThrow('maxHeapMb must be a positive integer')
  })
})

describe('extraction cache', () => {
  function docs(): Map<string, StoredFile> {
    return new Map([[`${ROOT}\\report.docx`, { bytes: storedZip(['word/document.xml']) }]])
  }

  it('answers a repeat and an offset call from the cache without reading bytes or spawning', async () => {
    const { ctx, spawns, reads } = await setup({ files: docs(), handles: [jsonHandle(result({ text: 'one\ntwo\nthree' }), 0)] })
    const first = await call(ctx, { file_path: 'report.docx', limit: 1 })
    expect(first.isError).toBe(false)
    const next = await call(ctx, { file_path: `${ROOT}\\report.docx`, offset: 2 })
    expect(next.isError).toBe(false)
    if (next.isError) return
    expect(next.value).toMatchObject({ lines: [{ number: 2, text: 'two' }, { number: 3, text: 'three' }], truncated: false })
    expect(spawns).toHaveLength(1)
    expect(reads()).toBe(1)
  })

  it('keys the cache by the target key, not the display path', async () => {
    const bytes = storedZip(['word/document.xml'])
    const files = new Map([
      ['D:\\a\\report.docx', { bytes }],
      ['D:\\b\\report.docx', { bytes }],
    ])
    let generation = 0
    const { ctx, spawns } = await setup({
      files,
      targetKey: displayPath => displayPath.startsWith('D:\\c\\') ? `other:${generation}` : 'one-file',
      handles: [
        jsonHandle(result({ text: 'shared' }), 0),
        jsonHandle(result({ text: 'before' }), 0),
        jsonHandle(result({ text: 'after' }), 0),
      ],
    })
    // Two display paths with one target key share one extraction.
    expect((await call(ctx, { file_path: 'D:\\a\\report.docx' })).isError).toBe(false)
    const alias = await call(ctx, { file_path: 'D:\\b\\report.docx' })
    expect(alias.isError).toBe(false)
    if (alias.isError) return
    expect(alias.value).toMatchObject({ path: 'D:\\b\\report.docx', lines: [{ number: 1, text: 'shared' }] })
    expect(spawns).toHaveLength(1)
    // One display path whose target key changes is a different file.
    files.set('D:\\c\\report.docx', { bytes })
    expect((await call(ctx, { file_path: 'D:\\c\\report.docx' })).isError).toBe(false)
    generation = 1
    const changed = await call(ctx, { file_path: 'D:\\c\\report.docx' })
    expect(changed.isError).toBe(false)
    if (changed.isError) return
    expect(changed.value).toMatchObject({ lines: [{ number: 1, text: 'after' }] })
    expect(spawns).toHaveLength(3)
  })

  it('returns the same notice and cap on a hit', async () => {
    const files = new Map([['D:\\scan.pdf', { bytes: Buffer.from('%PDF') }]])
    const handle = jsonHandle(result({ text: 'p', capped: ['pages'], pageCount: 60 }), 0)
    const { ctx, spawns } = await setup({ files, handles: [handle] })
    const first = await call(ctx, { file_path: 'D:\\scan.pdf' })
    const second = await call(ctx, { file_path: 'D:\\scan.pdf' })
    expect(first.isError || second.isError).toBe(false)
    if (first.isError || second.isError) return
    expect(second.value).toEqual(first.value)
    expect(second.value).toMatchObject({ truncated: true, notice: 'Extraction stopped at maxPages (50 of 60 pages).' })
    expect(spawns).toHaveLength(1)
  })

  it('extracts again when the file version changes', async () => {
    const files = docs()
    const { ctx, spawns } = await setup({
      files,
      handles: [jsonHandle(result({ text: 'old' }), 0), jsonHandle(result({ text: 'new' }), 0)],
    })
    await call(ctx, { file_path: 'report.docx' })
    const stored = files.get(`${ROOT}\\report.docx`)
    if (stored !== undefined) stored.version = 'v2'
    const read = await call(ctx, { file_path: 'report.docx' })
    expect(read.isError).toBe(false)
    if (read.isError) return
    expect(read.value).toMatchObject({ lines: [{ number: 1, text: 'new' }] })
    expect(spawns).toHaveLength(2)
  })

  it('returns but does not keep a result when the version changes between the two stats', async () => {
    const files = docs()
    const path = `${ROOT}\\report.docx`
    const { ctx, spawns } = await setup({
      files,
      onRead: () => {
        const stored = files.get(path)
        if (stored !== undefined) stored.version = 'v2'
      },
      handles: [jsonHandle(result({ text: 'racy' }), 0), jsonHandle(result({ text: 'fresh' }), 0)],
    })
    const first = await call(ctx, { file_path: 'report.docx' })
    expect(first.isError).toBe(false)
    if (first.isError) return
    expect(first.value).toMatchObject({ lines: [{ number: 1, text: 'racy' }] })
    const stored = files.get(path)
    if (stored !== undefined) stored.version = 'v1'
    const second = await call(ctx, { file_path: 'report.docx' })
    expect(second.isError).toBe(false)
    if (second.isError) return
    expect(second.value).toMatchObject({ lines: [{ number: 1, text: 'fresh' }] })
    expect(spawns).toHaveLength(2)
  })

  it('does not keep a result when the second stat fails', async () => {
    let stats = 0
    const { ctx, spawns } = await setup({
      files: docs(),
      onStat: () => {
        stats += 1
        if (stats === 2) throw new FsError('stat failed', 'FS_PERMISSION_DENIED')
        return undefined
      },
      handles: [jsonHandle(result({ text: 'a' }), 0), jsonHandle(result({ text: 'b' }), 0)],
    })
    expect((await call(ctx, { file_path: 'report.docx' })).isError).toBe(false)
    expect((await call(ctx, { file_path: 'report.docx' })).isError).toBe(false)
    expect(spawns).toHaveLength(2)
  })

  it('fails a session that cannot stat the path without touching the cache', async () => {
    let hidden = false
    const { ctx, spawns, reads } = await setup({
      files: docs(),
      onStat: () => hidden ? 'missing' : undefined,
      handles: [jsonHandle(result({ text: 'secret' }), 0)],
    })
    expect((await call(ctx, { file_path: `${ROOT}\\report.docx` })).isError).toBe(false)
    hidden = true
    const denied = await call(ctx, { file_path: `${ROOT}\\report.docx` }, undefined, {
      session: { header: { cwd: 'D:\\other-session' } },
    })
    expect(denied.isError).toBe(true)
    expect(denied.error?.info?.code).toBe('FS_NOT_FOUND')
    expect(text(denied)).not.toContain('secret')
    expect(spawns).toHaveLength(1)
    expect(reads()).toBe(1)
  })

  it('shares one child between two calls for the same file', async () => {
    const handle = manualHandle()
    const { ctx, spawns, reads } = await setup({ files: docs(), handles: [handle] })
    const a = call(ctx, { file_path: 'report.docx' })
    const b = call(ctx, { file_path: 'report.docx', offset: 2 })
    await until(() => spawns.length === 1)
    handle.finish(result({ text: 'x\ny' }))
    const [first, second] = await Promise.all([a, b])
    expect(first.isError || second.isError).toBe(false)
    if (first.isError || second.isError) return
    expect(first.value).toMatchObject({ lines: [{ number: 1, text: 'x' }, { number: 2, text: 'y' }] })
    expect(second.value).toMatchObject({ lines: [{ number: 2, text: 'y' }] })
    expect(spawns).toHaveLength(1)
    expect(reads()).toBe(1)
  })

  it('keeps the shared child for the second caller when the first aborts', async () => {
    const handle = manualHandle()
    const { ctx, spawns } = await setup({ files: docs(), handles: [handle] })
    const first = new AbortController()
    const a = call(ctx, { file_path: 'report.docx' }, first.signal)
    const b = call(ctx, { file_path: 'report.docx' })
    await until(() => spawns.length === 1)
    first.abort(new Error('first caller left'))
    expect(text(await a)).toContain('first caller left')
    expect(handle.terminated).toBe(false)
    handle.finish(result({ text: 'kept' }))
    const second = await b
    expect(second.isError).toBe(false)
    if (second.isError) return
    expect(second.value).toMatchObject({ lines: [{ number: 1, text: 'kept' }] })
  })

  it('stops the shared child when every caller aborts', async () => {
    const handle = hangHandle()
    const { ctx, spawns } = await setup({ files: docs(), handles: [handle, jsonHandle(result({ text: 'later' }), 0)] })
    const first = new AbortController()
    const second = new AbortController()
    const a = call(ctx, { file_path: 'report.docx' }, first.signal)
    const b = call(ctx, { file_path: 'report.docx' }, second.signal)
    await until(() => spawns.length === 1)
    first.abort(new Error('one'))
    second.abort(new Error('two'))
    expect(text(await a)).toContain('one')
    expect(text(await b)).toContain('two')
    await until(() => handle.waited)
    const later = await call(ctx, { file_path: 'report.docx' })
    expect(later.isError).toBe(false)
    expect(spawns).toHaveLength(2)
  })
})

describe('child slots', () => {
  function files(...names: string[]): Map<string, StoredFile> {
    return new Map(names.map(name => [`D:\\${name}.pdf`, { bytes: Buffer.from('%PDF') }]))
  }

  it('runs at most maxConcurrent children and starts the next when one exits', async () => {
    const handles = [manualHandle(), manualHandle(), manualHandle()]
    const { ctx, spawns } = await setup({ files: files('a', 'b', 'c'), handles })
    const reads = ['a', 'b', 'c'].map(name => call(ctx, { file_path: `D:\\${name}.pdf` }))
    await until(() => spawns.length === 2)
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    expect(spawns).toHaveLength(2)
    handles[0]?.finish(result({ text: 'first' }))
    await until(() => spawns.length === 3)
    handles[1]?.finish(result({ text: 'second' }))
    handles[2]?.finish(result({ text: 'third' }))
    const results = await Promise.all(reads)
    expect(results.map(entry => entry.isError)).toEqual([false, false, false])
  })

  it('fails at once as busy when the queue is full', async () => {
    const running = manualHandle()
    const { ctx, spawns } = await setup({
      files: files('a', 'b', 'c'),
      config: { maxConcurrent: 1, maxQueued: 1 },
      handles: [running, jsonHandle(result({ text: 'b' }), 0)],
    })
    const a = call(ctx, { file_path: 'D:\\a.pdf' })
    await until(() => spawns.length === 1)
    const b = call(ctx, { file_path: 'D:\\b.pdf' })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    const c = await call(ctx, { file_path: 'D:\\c.pdf' })
    expect(c.isError).toBe(true)
    expect(text(c)).toContain('read_document is busy; retry after the running reads finish')
    running.finish(result({ text: 'a' }))
    expect((await a).isError).toBe(false)
    expect((await b).isError).toBe(false)
  })

  it('does not count time spent waiting for a slot against the timeout', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { ctx } = await setup({
      files: files('a', 'b'),
      config: { maxConcurrent: 1, timeoutMs: 40 },
      onRead: path => path === 'D:\\a.pdf' ? gate.promise.then(() => {}) : undefined,
      handles: [jsonHandle(result({ text: 'a' }), 0), jsonHandle(result({ text: 'b' }), 0)],
    })
    const a = call(ctx, { file_path: 'D:\\a.pdf' })
    const b = call(ctx, { file_path: 'D:\\b.pdf' })
    await new Promise((resolve) => { setTimeout(resolve, 120) })
    gate.resolve(undefined)
    const [first, second] = await Promise.all([a, b])
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(text(second)).not.toContain('timed out')
  })

  it('removes a caller that aborts while queued', async () => {
    const running = manualHandle()
    const { ctx, spawns } = await setup({
      files: files('a', 'b', 'c'),
      config: { maxConcurrent: 1, maxQueued: 1 },
      handles: [running, jsonHandle(result({ text: 'c' }), 0)],
    })
    const a = call(ctx, { file_path: 'D:\\a.pdf' })
    await until(() => spawns.length === 1)
    const leaving = new AbortController()
    const b = call(ctx, { file_path: 'D:\\b.pdf' }, leaving.signal)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    leaving.abort(new Error('gave up waiting'))
    expect(text(await b)).toContain('gave up waiting')
    const c = call(ctx, { file_path: 'D:\\c.pdf' })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    running.finish(result({ text: 'a' }))
    expect((await a).isError).toBe(false)
    const third = await c
    expect(third.isError).toBe(false)
    if (third.isError) return
    expect(third.value).toMatchObject({ lines: [{ number: 1, text: 'c' }] })
    expect(spawns).toHaveLength(2)
  })

  it('rejects queued calls and stops running children on dispose', async () => {
    const running = hangHandle()
    const { ctx, fiber, spawns } = await setup({
      files: files('a', 'b'),
      config: { maxConcurrent: 1 },
      handles: [running],
    })
    const a = call(ctx, { file_path: 'D:\\a.pdf' })
    await until(() => spawns.length === 1)
    const b = call(ctx, { file_path: 'D:\\b.pdf' })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    await fiber.dispose()
    expect(running.waited).toBe(true)
    const queued = await b
    expect(queued.isError).toBe(true)
    expect(text(queued)).toContain('read_document stopped because the plugin is shutting down')
    expect((await a).isError).toBe(true)
    expect(spawns).toHaveLength(1)
  })
})
