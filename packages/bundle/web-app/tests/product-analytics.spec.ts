import OTel from '@deepseek-ai/dsh-otel'
/** Product analytics stays off in every launch, Desktop included. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Telemetry from '@deepseek-ai/dsh-host-product-telemetry-otel'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it.each(['desktop', 'web'])('keeps product analytics and its collector off: %s', async (profile) => {
  const requests: string[] = []
  const server = createServer((req) => { requests.push(req.url ?? ''); req.resume() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  vi.stubEnv('DSH_CLIENT_VERSION', 'test-version')
  vi.stubEnv('DSH_PRODUCT_ANALYTICS_OTLP_URL', `http://127.0.0.1:${address.port}/logs`)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  ctx.provide('deepseekAccount', { getDeviceIdentity: vi.fn().mockResolvedValue(undefined) } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  const rows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  expect(rows).toHaveLength(2)
  const entries = rows.map(row => ({ ...row, name: row.id === 'desktop-product-telemetry' ? 'cordis:telemetry' : 'cordis:analytics' }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  expect(ctx.loader.resolve('desktop-product-telemetry').disabled).toBe(true)
  expect(ctx.loader.resolve('product-analytics').disabled).toBe(true)
  expect(ctx.get('productTelemetry')).toBeUndefined()
  expect(ctx.get('productAnalytics')).toBeUndefined()
  await ctx.fiber.dispose()
  expect(requests).toEqual([])
})
