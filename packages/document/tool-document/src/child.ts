/**
 * Spawn one read-only sandbox child per `read_document` call.
 * The child receives file bytes on stdin and returns JSON text on stdout.
 * Argv never includes the user path. There is no in-host parse fallback.
 * @module @deepseek-ai/dsh-tool-document/child
 */

import { Readable } from 'node:stream'
import type { Readable as ReadableStream, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

/** Names that must not reach the child environment. */
const SENSITIVE_ENV = /KEY|SECRET|TOKEN|PASSWORD/i

/** Diagnostic stderr tail. This is not extracted document text. */
const STDERR_TAIL_BYTES = 16 * 1024

/** Extra stdout bytes allowed beyond the extracted-character cap, for JSON framing. */
const STDOUT_MARGIN_BYTES = 1024

/** Document kinds the child knows how to dispatch. */
export type DocumentFormat = 'docx' | 'pdf' | 'xlsx'

/** Caps and format passed to the child as one JSON argv element. */
export interface ChildRequest {
  /** Which parser the child should run. */
  format: DocumentFormat
  /** Maximum PDF pages the child may read. */
  maxPages: number
  /** Maximum characters the child may return. */
  maxExtractedChars: number
  /** Maximum Excel sheets the child may read. */
  maxSheets: number
  /** Maximum data rows the child may read from one sheet. */
  maxRowsPerSheet: number
}

/** Text the child wrote, plus the PDF notice when the file has no text layer. */
export interface ChildOutput {
  /** Extracted document text. */
  text: string
  /** Set only when a PDF has no text layer. */
  notice?: string
}

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
  /** Parent deadline. The same value is the subprocess grace period. */
  timeoutMs: number
  /** Caller cancellation. Abort kills the child and awaits exit. */
  signal: AbortSignal
  /** Absolute directory the confined process starts in. */
  workspaceRoot: string
  /** Session whose sandbox policy supplied the workspace root, when there is one. */
  sessionId?: SandboxPolicy['sessionId']
  /** Stops the child when the plugin fiber disposes. */
  watch: ChildWatch
}

/**
 * Drop environment entries whose names match `KEY`, `SECRET`, `TOKEN`, or `PASSWORD`.
 * @param source - the environment to copy. Defaults to the parent process.
 * @returns the environment passed to the child.
 */
export function scrubbedChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || SENSITIVE_ENV.test(key)) continue
    env[key] = value
  }
  return env
}

/**
 * Argv for one child. Source launches add the tsx loader; built launches run `worker.js`.
 * The last element is the JSON request. The user path is not an argument.
 * @param moduleUrl - `import.meta.url` of this module, selecting `worker.ts` or `worker.js`.
 * @param execPath - the Node binary to spawn.
 * @param tsxSpecifier - the tsx ESM loader specifier used for source launches.
 * @param request - format and caps encoded as the final argument.
 * @returns the argv passed to sandbox confinement.
 */
export function childArgv(moduleUrl: string, execPath: string, tsxSpecifier: string, request: ChildRequest): string[] {
  const source = moduleUrl.endsWith('.ts')
  const worker = fileURLToPath(new URL(source ? './worker.ts' : './worker.js', moduleUrl))
  const payload = JSON.stringify(request)
  if (source) return [execPath, '--import', tsxSpecifier, worker, payload]
  return [execPath, worker, payload]
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
 * @param raw - the full stdout text.
 * @returns the extracted text and the optional PDF notice.
 */
export function parseChildOutput(raw: string): ChildOutput {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`read_document child returned invalid JSON: ${reason}`)
  }
  if (typeof value !== 'object' || value === null) throw new Error('read_document child returned an unexpected result')
  if (!('text' in value) || typeof value.text !== 'string') throw new Error('read_document child returned an unexpected result')
  const notice = 'notice' in value ? value.notice : undefined
  if (notice !== undefined && typeof notice !== 'string') throw new Error('read_document child returned an unexpected result')
  return notice === undefined ? { text: value.text } : { text: value.text, notice }
}

class ChildOutputCapError extends Error {
  constructor() {
    super('read_document child output exceeded its byte cap')
    this.name = 'ChildOutputCapError'
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error('read_document aborted')
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
  if (detail.length > 0) return new Error(`read_document child failed: ${detail}`)
  if (outcome.exitCode === null) return new Error('read_document child was stopped')
  return new Error(`read_document child failed with exit code ${outcome.exitCode}`)
}

/**
 * Confine and spawn one child, then wait until it exits.
 * `SANDBOX_UNAVAILABLE` from `confine` propagates. Timeout, abort, and disposal kill the child and await exit.
 * @param ctx - the plugin context providing `sandbox` and `subprocess`.
 * @param run - bytes, request, deadline, and the disposal hook.
 * @returns the child's text and optional notice.
 */
export async function runChild(ctx: Context, run: ChildRun): Promise<ChildOutput> {
  run.signal.throwIfAborted()
  const argv = childArgv(import.meta.url, process.execPath, import.meta.resolve('tsx/esm'), run.request)
  const confined = await ctx.sandbox.confine(argv, {
    mode: 'read-only',
    workspaceRoot: run.workspaceRoot,
    ...run.sessionId === undefined ? {} : { sessionId: run.sessionId },
  }, run.signal)
  run.signal.throwIfAborted()
  const handle = ctx.subprocess.spawn({
    argv: confined.argv,
    cwd: run.workspaceRoot,
    stdio: {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: { maxBytes: STDERR_TAIL_BYTES },
    },
    graceMs: run.timeoutMs,
    signal: run.signal,
    env: scrubbedChildEnv(),
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
