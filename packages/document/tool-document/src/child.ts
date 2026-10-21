/**
 * Spawn one read-only sandbox child per `read_document` extraction.
 * The child receives file bytes on stdin and returns JSON text on stdout.
 * Argv never includes the user path. There is no in-host parse fallback.
 * The spawn passes no `env`: the subprocess service builds every child environment from `scrubbedParentEnv()`,
 * which already drops credential-shaped names and every `DSH_*` name and restores the user's proxy variables.
 * @module @deepseek-ai/dsh-tool-document/child
 */

import { Readable } from 'node:stream'
import type { Readable as ReadableStream, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { SANDBOX_UNAVAILABLE, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { abortError } from './errors.ts'
import type { ChildOutput, ChildRequest, ExtractionCap } from './extract.ts'

/** Diagnostic stderr tail. This is not extracted document text. */
const STDERR_TAIL_BYTES = 16 * 1024

/** Extra stdout bytes allowed beyond the extracted-character cap, for JSON framing. */
const STDOUT_MARGIN_BYTES = 1024

/** Time between the polite stop and the forced kill once the parent stops a child. */
const GRACE_MS = 2_000

/** V8's fatal message when the child reaches `--max-old-space-size`. */
const OUT_OF_MEMORY = /heap out of memory/i

/** Valid `capped` entries in the order the child lists them. */
const CAP_ORDER: readonly ExtractionCap[] = ['pages', 'sheets', 'rows', 'chars']

/** Model-facing error when the host has no usable read-only sandbox. Retrying cannot succeed. */
const SANDBOX_UNAVAILABLE_MESSAGE = 'read_document cannot run because no sandbox is available on this host; do not retry'

/** Model-facing error when the child dies at its heap cap. The stack is not shown. */
const OUT_OF_MEMORY_MESSAGE = 'read_document ran out of memory; the file is too large to extract'

/**
 * Disposal hook for one live child.
 * Plugin disposal calls `terminate` and waits until `release`.
 */
export interface ChildWatch {
  /**
   * Register one live child so disposal can stop it.
   * @param handle - the spawned child. `terminate` is idempotent.
   * @returns a release called after the child has been awaited.
   */
  watch(handle: { terminate(): void }): { release(): void }
}

/** One confined extraction. */
export interface ChildRun {
  /** File bytes already read by the parent. The child does not open the path. */
  bytes: Uint8Array
  /** Format and parser caps. */
  request: ChildRequest
  /** Parent deadline, counted from spawn. */
  timeoutMs: number
  /** V8 old-space cap for the child, in MiB. */
  maxHeapMb: number
  /** Cancellation. Abort kills the child and awaits exit. */
  signal: AbortSignal
  /** Absolute directory the confined process starts in. */
  workspaceRoot: string
  /** Session whose sandbox policy supplied the workspace root, when there is one. */
  sessionId?: SandboxPolicy['sessionId']
  /** Stops the child when the plugin fiber disposes. */
  watch: ChildWatch
}

/**
 * Thrown when `confine` reports `SANDBOX_UNAVAILABLE`. It keeps that code and tells the model not to retry.
 * The original error is the `cause`.
 */
export class DocumentSandboxUnavailableError extends SandboxUnavailableError {
  /** @param cause - the error `confine` threw. */
  constructor(cause: unknown) {
    super('read-only')
    this.message = SANDBOX_UNAVAILABLE_MESSAGE
    this.cause = cause
  }
}

/**
 * Argv for one child. Source launches add the tsx loader; built launches run `worker.js`.
 * Both cap the V8 heap. The last element is the JSON request. The user path is not an argument.
 * @param moduleUrl - `import.meta.url` of this module, selecting `worker.ts` or `worker.js`.
 * @param execPath - the Node binary to spawn.
 * @param tsxSpecifier - resolves the tsx ESM loader. Called only for source launches.
 * @param request - format and caps encoded as the final argument.
 * @param maxHeapMb - the `--max-old-space-size` value in MiB.
 * @returns the argv passed to sandbox confinement.
 */
export function childArgv(
  moduleUrl: string,
  execPath: string,
  tsxSpecifier: () => string,
  request: ChildRequest,
  maxHeapMb: number,
): string[] {
  const source = moduleUrl.endsWith('.ts')
  const worker = fileURLToPath(new URL(source ? './worker.ts' : './worker.js', moduleUrl))
  const payload = JSON.stringify(request)
  const heap = `--max-old-space-size=${maxHeapMb}`
  if (source) return [execPath, heap, '--import', tsxSpecifier(), worker, payload]
  return [execPath, heap, worker, payload]
}

/**
 * Byte cap for the child's stdout, derived from the extracted-character cap.
 * @param maxExtractedChars - the configured character cap.
 * @returns the maximum stdout bytes the parent will accept.
 */
export function stdoutByteCap(maxExtractedChars: number): number {
  return maxExtractedChars * 8 + STDOUT_MARGIN_BYTES
}

/**
 * Parse the child's stdout JSON.
 * `capped` must be a non-empty array of known caps in {@link ExtractionCap} order without duplicates.
 * @param raw - the full stdout text.
 * @returns the extracted text, the optional PDF notice, and the caps with their counts.
 */
export function parseChildOutput(raw: string): ChildOutput {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    /* v8 ignore next -- JSON.parse throws a SyntaxError */
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`read_document child returned invalid JSON: ${reason}`)
  }
  if (typeof value !== 'object' || value === null) throw unexpectedOutput()
  const record: Record<string, unknown> = { ...value }
  if (typeof record.text !== 'string') throw unexpectedOutput()
  const notice = optionalString(record.notice)
  const capped = parseCapped(record.capped)
  const pageCount = optionalNumber(record.pageCount)
  const sheetCount = optionalNumber(record.sheetCount)
  const rowsSheet = optionalString(record.rowsSheet)
  return {
    text: record.text,
    ...notice === undefined ? {} : { notice },
    ...capped === undefined ? {} : { capped },
    ...pageCount === undefined ? {} : { pageCount },
    ...sheetCount === undefined ? {} : { sheetCount },
    ...rowsSheet === undefined ? {} : { rowsSheet },
  }
}

function unexpectedOutput(): Error {
  return new Error('read_document child returned an unexpected result')
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'string') return value
  throw unexpectedOutput()
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || typeof value === 'number') return value
  throw unexpectedOutput()
}

function parseCapped(value: unknown): ExtractionCap[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) throw unexpectedOutput()
  const capped: ExtractionCap[] = []
  let previous = -1
  for (const item of value) {
    const index = CAP_ORDER.findIndex(cap => cap === item)
    // An unknown entry has no cap; a duplicate or out-of-order entry does not move forward.
    const cap = CAP_ORDER[index]
    if (cap === undefined || index <= previous) throw unexpectedOutput()
    capped.push(cap)
    previous = index
  }
  return capped
}

class ChildOutputCapError extends Error {
  constructor() {
    super('read_document child output exceeded its byte cap')
    this.name = 'ChildOutputCapError'
  }
}

function chunkBuffer(chunk: Buffer | string): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk)
  return chunk
}

async function readStdout(stdout: ReadableStream, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stdout) {
    const buf = chunkBuffer(chunk as Buffer | string)
    total += buf.length
    if (total > maxBytes) throw new ChildOutputCapError()
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function childFailure(handle: SubprocessHandle, outcome: SubprocessOutcome): Error {
  const detail = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
  if (OUT_OF_MEMORY.test(detail)) return new Error(OUT_OF_MEMORY_MESSAGE)
  if (detail.length > 0) return new Error(`read_document child failed: ${detail}`)
  if (outcome.exitCode === null) return new Error('read_document child was stopped')
  return new Error(`read_document child failed with exit code ${outcome.exitCode}`)
}

function isSandboxUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === SANDBOX_UNAVAILABLE
}

/**
 * Confine and spawn one child, then wait until it exits.
 * `SANDBOX_UNAVAILABLE` from `confine` becomes {@link DocumentSandboxUnavailableError}.
 * Timeout, abort, and disposal kill the child and await exit. The deadline starts at spawn.
 * @param ctx - the plugin context providing `sandbox` and `subprocess`.
 * @param run - bytes, request, deadline, heap cap, and the disposal hook.
 * @returns the child's text, optional notice, and caps.
 */
export async function runChild(ctx: Context, run: ChildRun): Promise<ChildOutput> {
  run.signal.throwIfAborted()
  const argv = childArgv(import.meta.url, process.execPath, () => import.meta.resolve('tsx/esm'), run.request, run.maxHeapMb)
  const confined = await ctx.sandbox.confine(argv, {
    mode: 'read-only',
    workspaceRoot: run.workspaceRoot,
    ...run.sessionId === undefined ? {} : { sessionId: run.sessionId },
  }, run.signal).catch((error: unknown) => {
    throw isSandboxUnavailable(error) ? new DocumentSandboxUnavailableError(error) : error
  })
  run.signal.throwIfAborted()
  const handle = ctx.subprocess.spawn({
    argv: confined.argv,
    cwd: run.workspaceRoot,
    stdio: {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: { maxBytes: STDERR_TAIL_BYTES },
    },
    graceMs: GRACE_MS,
    signal: run.signal,
  })
  const watched = run.watch.watch(handle)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    handle.terminate()
  }, run.timeoutMs)
  const onAbort = (): void => { handle.terminate() }
  run.signal.addEventListener('abort', onAbort)
  try {
    return await collectChild(handle, run, () => timedOut)
  } finally {
    clearTimeout(timer)
    run.signal.removeEventListener('abort', onAbort)
    try {
      handle.terminate()
      await handle.waitForExit()
    } finally {
      watched.release()
    }
  }
}

async function collectChild(handle: SubprocessHandle, run: ChildRun, timedOut: () => boolean): Promise<ChildOutput> {
  const stdin: Writable | undefined = handle.stdin
  const stdout: ReadableStream | undefined = handle.stdout
  if (stdin === undefined || stdout === undefined) throw new Error('read_document child was started without pipes')
  // pipeline() rejects with a closed-stream error when stdin is already destroyed.
  // destroy() emits its error on a later turn, so this listener stays attached.
  let stdinError: Error | undefined = stdin.errored instanceof Error ? stdin.errored : undefined
  const onStdinError = (error: Error): void => {
    if (stdinError === undefined) stdinError = error
  }
  stdin.on('error', onStdinError)
  let output = ''
  let pipeError: Error | undefined
  try {
    await pipeline(Readable.from([Buffer.from(run.bytes)]), stdin)
    output = await readStdout(stdout, stdoutByteCap(run.request.maxExtractedChars))
  } catch (error) {
    pipeError = error instanceof Error ? error : new Error(String(error))
    handle.terminate()
  }
  const outcome = await handle.done
  if (stdinError === undefined && stdin.errored instanceof Error) stdinError = stdin.errored
  if (run.signal.aborted) throw abortError(run.signal)
  if (timedOut()) throw new Error('read_document timed out')
  if (pipeError instanceof ChildOutputCapError) throw pipeError
  if (outcome.exitCode !== 0) throw childFailure(handle, outcome)
  if (stdinError !== undefined) throw stdinError
  if (pipeError !== undefined) throw pipeError
  return parseChildOutput(output)
}
