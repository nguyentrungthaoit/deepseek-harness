/** Real Loader composition: cordis.yml mounts `read_document` and its required services. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { LoadResult, ModuleLoaderV2, ResolveResult } from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolDocument from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function sourceLoader(modules: ReadonlyMap<string, unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    loadCache: Object.create(Map.prototype) as ModuleLoaderV2['loadCache'],
    import(specifier: string): Promise<unknown> {
      if (!modules.has(specifier)) return Promise.reject(new Error(`unexpected Loader import: ${specifier}`))
      return Promise.resolve(modules.get(specifier))
    },
    register(): void {
      throw new Error('source loader register is unused')
    },
    getOrCreateModuleJob(): Promise<never> {
      return Promise.reject(new Error('source loader getOrCreateModuleJob is unused'))
    },
    resolveSync(): ResolveResult {
      throw new Error('source loader resolveSync is unused')
    },
    load(): Promise<LoadResult> {
      return Promise.reject(new Error('source loader load is unused'))
    },
  }
}

async function boot(limit: number | string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-document-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-sandbox-policy'",
    '  config:',
    `    workspaceRoot: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-sandbox-local'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-tool-document'",
    '  config:',
    `    limit: ${limit}`,
    '',
  ].join('\n'))
  await writeFile(join(root, 'notes.txt'), 'plain text')

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = sourceLoader(new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-sandbox-policy', SandboxPolicy],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-sandbox-local', LocalSandbox],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-document', ToolDocument],
  ]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('tool-document real Loader composition through cordis.yml', () => {
  it('mounts read_document with the configured line cap and executes it', async () => {
    const ctx = await boot(7)
    const schema = ctx.tools.schemas().find(tool => tool.name === 'read_document')
    expect(schema?.description).toContain('read rejects binary')
    expect(schema?.parameters).toHaveProperty('properties.limit.description', expect.stringContaining('Defaults to 7'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-read'),
      name: 'read_document',
      arguments: { file_path: 'notes.txt' },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('only .docx, .pdf, and .xlsx')
  }, 60_000)

  it('fails loading when limit is not a positive integer', async () => {
    await expect(boot(0)).rejects.toThrow('tool-document: limit must be a positive integer')
  }, 60_000)
})
