// Web e2e scenario: the MCP panel behind the sidebar's MCP entry over a managed scaffold
// profile. A stdio server is added through the form, inspected, edited without retyping its
// secret, toggled, and deleted. Zero model calls: the server is a local fixture process and
// everything else is profile files and client state.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, openSettings, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/mcp-manager', import.meta.url))
const SERVER = fileURLToPath(new URL('./fixtures/mcp/stdio-server.mjs', import.meta.url))
const MODE = webSnapshotMode()
const SECRET = 'mcp-e2e-secret-value'
const PANEL = '[data-mcp-panel]'

describe('web e2e: MCP panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  /** Every WebSocket frame the browser received, checked for secret values. */
  const frames: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => { frames.push(String(frame.payload)) })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  const patchPath = (): string => join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
  const aria = (): Promise<string> => captureStableAria(page, PANEL, scaffold.workspaceCwd, {
    replacements: [[process.execPath, '<node>'], [SERVER, '<fixture-server>']],
  })

  async function openPanel(heading: string, entry: string): Promise<void> {
    if (await page.locator(PANEL).count() === 0) {
      await page.getByRole('navigation', { name: /全局面板|Global panels/ }).getByRole('button', { name: entry, exact: true }).click()
    }
    await page.locator(PANEL).getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 10_000 })
  }

  it('adds, inspects, edits, toggles, and deletes a stdio server without exposing its secret', async () => {
    onTestFailed(() => saveFailureShot(page, 'mcp-manager'))
    await openPanel('MCP 服务器', 'MCP')
    const panel = page.locator(PANEL)
    await panel.getByText('尚未配置 MCP 服务器').waitFor()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'empty.expected.md'), await aria(), MODE)

    await panel.getByRole('button', { name: '添加服务器' }).click()
    await panel.getByLabel('服务器名称').fill('fixture')
    await panel.getByLabel('命令').fill(process.execPath)
    await panel.getByLabel('参数，每行一个').fill(SERVER)
    await panel.getByRole('button', { name: '添加一项' }).click()
    await panel.getByRole('textbox', { name: '名称', exact: true }).fill('TOKEN')
    await panel.getByLabel('值', { exact: true }).fill(SECRET)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'form.expected.md'), await aria(), MODE)
    await panel.getByRole('button', { name: '保存' }).click()

    await panel.getByRole('heading', { name: 'fixture', exact: true }).waitFor({ timeout: 20_000 })
    await expect.poll(() => panel.getByText('已连接').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await panel.getByText('mcp__fixture__echo').waitFor()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'detail.expected.md'), await aria(), MODE)
    expect(await readFile(patchPath(), 'utf8')).toContain(SECRET)

    await panel.getByRole('button', { name: '编辑' }).click()
    await panel.getByText('高级').click()
    await panel.getByLabel('工具调用超时（毫秒）').fill('5000')
    await panel.getByRole('button', { name: '保存' }).click()
    await panel.getByRole('heading', { name: 'fixture', exact: true }).waitFor({ timeout: 20_000 })
    await expect.poll(async () => await readFile(patchPath(), 'utf8'), { timeout: 10_000 }).toContain('toolCallTimeoutMs: 5000')
    expect(await readFile(patchPath(), 'utf8')).toContain(SECRET)

    await panel.getByRole('button', { name: '返回' }).click()
    const toggle = panel.getByRole('switch', { name: '启用' })
    await toggle.click()
    await expect.poll(() => panel.getByText('已停用').count(), { timeout: 20_000 }).toBeGreaterThan(0)
    await toggle.click()
    await expect.poll(() => panel.getByText('已连接').count(), { timeout: 20_000 }).toBeGreaterThan(0)

    await panel.getByRole('button', { name: /fixture/ }).click()
    await panel.getByRole('button', { name: '删除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click()
    await panel.getByText('尚未配置 MCP 服务器').waitFor({ timeout: 20_000 })
    expect(await readFile(patchPath(), 'utf8')).not.toContain('mcp-fixture')

    expect(await page.locator('body').innerText()).not.toContain(SECRET)
    expect(frames.some(frame => frame.includes(SECRET))).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

  it('renders the empty panel in English', async () => {
    onTestFailed(() => saveFailureShot(page, 'mcp-manager-en'))
    await openSettings(page, 'zh')
    await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '中文' }).click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    await page.keyboard.press('Escape')
    await openPanel('MCP servers', 'MCP')
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'empty-en.expected.md'), await aria(), MODE)
  }, 60_000)
})
