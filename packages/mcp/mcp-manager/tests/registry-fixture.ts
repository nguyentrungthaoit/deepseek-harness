/** A booted profile with the config editor, the tool registry, and the MCP registry; MCP rows load `dsh-mcp-client`. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import McpServerRegistry from '../src/index.ts'

/** The MCP row module in these profiles: the client, mounted as a Loader builtin. */
export const MCP_MODULE = 'cordis:mcp-client'

/** The stdio fixture server, started with the current Node executable. */
export const SERVER = fileURLToPath(new URL('./fixtures/stdio-server.mjs', import.meta.url))

/** A stdio row config for the fixture server. */
export function stdioRow(serverName: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { transport: 'stdio', serverName, command: process.execPath, args: [SERVER], ...extra }
}

/** One `insert` element for a `dsh-mcp-client` row. */
export function mcpRow(id: string, config: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: MCP_MODULE, config, ...extra }
}

/**
 * Boot a profile whose bundle layer and profile patch hold the given rows.
 * @param options - layer rows from the bundle, profile patch rows, whether HMR is mounted, and a replacement client module.
 * @returns the root Context and the profile.
 */
export async function registryFixture(options: { layer?: object[]; profile?: object[]; hmr?: boolean; client?: object } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-manager-')))
  const dir = join(home, 'profiles', 'test')
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'system-prompt', name: 'cordis:prompt' },
    { id: 'tools', name: 'cordis:tools' },
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'mcp-manager', name: 'cordis:registry', config: { moduleNames: [MCP_MODULE] } },
    ...options.layer ?? [],
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  writeFileSync(profile.patchPath, `${JSON.stringify(options.profile ?? [], null, 2)}\n`)
  const ctx: Context = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (host) => {
    host.provide('profileContext', profile)
    host.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(host.loader.builtins, { prompt: SystemPrompt, tools: ToolRuntime, editor: ConfigEditor, registry: McpServerRegistry, 'mcp-client': options.client ?? McpClient })
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  if (options.hmr !== false) {
    await ctx.plugin(Timer)
    const hmr = ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    await hmr.await()
    await ctx.hmr.runExclusive(async () => {})
  }
  await ctx.loader.await()
  return { ctx, profile }
}
