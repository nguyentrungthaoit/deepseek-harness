/**
 * MCP manager, browser half: the **MCP** entry of the sidebar and the
 * management page it opens in the main column. The page lists the Host's MCP
 * servers with their connection status and tools, and adds, edits, removes,
 * reconnects, and switches them through the `mcp` Remote (and the optional
 * `pluginManager` Remote for the enabled switch).
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face
// (`mcp/change` and `plugin-manager/changed` are selected by the assembly).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-mcp-manager/types'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { McpCatalog } from './catalog.ts'
import { en, zh } from './locales.ts'
import { McpPanel, type McpPanelFace } from './McpPanel.tsx'
import { McpPanelIcon } from './McpPanelIcon.tsx'
import { createNavigationStore } from './navigation-store.ts'

export type { McpPanelFace, McpPanelProps } from './McpPanel.tsx'
export type { McpManagerLocaleKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
export const NS = 'mcpManager'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'mcp' as MainPanelId

/**
 * Services required by the registrations and the `mcp` Remote; `remote.pluginManager`,
 * which the assembly mounts before `mcp`, is read at apply.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.mcp', 'layout']

/**
 * Contribute the MCP entry to the sidebar with the management page it opens,
 * and keep it current on the Host's change events.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  // Enable and disable go through Plugin Manager; an assembly without it still lists and edits.
  // Read without injecting it: an injected namespace would make Plugin Manager a hard requirement.
  const pluginManager = ctx.get('remote.pluginManager') as ClientContext['remote']['pluginManager'] | undefined
  const catalog = new McpCatalog(ctx.remote.mcp, pluginManager)
  const face: McpPanelFace = {
    hooks: { catalog: catalog.snapshots },
    canToggle: catalog.canToggle,
    refresh: () => catalog.refresh(),
    create: draft => catalog.create(draft),
    update: (entryId, draft) => catalog.update(entryId, draft),
    remove: entryId => catalog.remove(entryId),
    reconnect: (entryId, options) => catalog.reconnect(entryId, options),
    setEnabled: (entryId, enabled) => catalog.setEnabled(entryId, enabled),
  }
  ctx.effect(() => {
    // A page never opened holds no list to refresh; the catalog coalesces overlapping lists.
    const refresh = (): void => {
      const opened = catalog.snapshots.getSnapshot().phase !== 'loading'
        || ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
      if (opened) void catalog.refresh()
    }
    const disposers = [
      ctx.remote.$on('mcp/change', refresh),
      ctx.remote.$on('plugin-manager/changed', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-mcp-manager: host invalidations')

  ctx.slots.inject('main', function* () {
    // One navigation instance per registration, so deselecting the panel can reset it.
    const navigation = createNavigationStore()
    const view = navigation.create()
    yield ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => face, locale: NS, store: { ...navigation, create: () => view } }, McpPanel)
    let active = ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
    yield ctx.layout.panelInfo.subscribe(() => {
      const now = ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
      if (now && !active) void catalog.refresh()
      if (!now) view.actions.reset()
      active = now
    })
  })
  // Directly after the Plugins entry (order 0).
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('panel'),
    locale: NS,
  }, McpPanelIcon))
}
