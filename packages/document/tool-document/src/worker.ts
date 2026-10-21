/**
 * Child entry for `read_document`.
 * Checks the environment, reads the request from argv and file bytes from stdin, and writes JSON to stdout.
 * The user path is not in argv. Request parsing and dispatch live in `extract.ts`.
 * @module @deepseek-ai/dsh-tool-document/worker
 */

import { extract, readRequest } from './extract.ts'

const SENSITIVE_ENV = /KEY|SECRET|TOKEN|PASSWORD/i

function assertCleanEnvironment(): void {
  const names = Object.keys(process.env).filter(name => SENSITIVE_ENV.test(name)).sort()
  if (names.length === 0) return
  process.stderr.write(`refusing credential-shaped environment: ${names.join(', ')}\n`)
  process.exit(1)
}

function childSignal(): AbortSignal {
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  process.once('SIGTERM', abort)
  process.once('SIGINT', abort)
  return controller.signal
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
    else throw new Error('read_document child stdin chunk was not bytes')
  }
  return Buffer.concat(chunks)
}

async function main(): Promise<void> {
  assertCleanEnvironment()
  const raw = process.argv.at(-1)
  if (raw === undefined) throw new Error('read_document child is missing its request')
  const request = readRequest(raw)
  const bytes = await readStdin()
  const result = await extract(request, bytes, childSignal())
  process.stdout.write(JSON.stringify(result))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
