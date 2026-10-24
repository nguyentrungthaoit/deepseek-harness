/**
 * MCP main panel: the header with the Add button, and the body the navigation
 * view selects (server list, one server, or the create and edit form).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpReconnectOptions, McpServerDraft } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpCatalogSnapshot, McpOutcome } from './catalog.ts'
import type { McpManagerLocaleKey } from './locales.ts'
import css from './McpPanel.module.css'
import type { createNavigationStore } from './navigation-store.ts'
import { ServerDetail } from './ServerDetail.tsx'
import { ServerForm } from './ServerForm.tsx'
import { ServerList } from './ServerList.tsx'

/** What the panel reads from the catalog. */
export interface McpPanelFace {
  hooks: {
    /** The catalog's snapshot store. */
    catalog: SnapshotStore<McpCatalogSnapshot>
  }
  /** Whether enable and disable can reach the Host. */
  canToggle: boolean
  /** List the servers again. */
  refresh: () => Promise<void>
  create: (draft: McpServerDraft) => Promise<McpOutcome>
  update: (entryId: string, draft: McpServerDraft) => Promise<McpOutcome>
  remove: (entryId: string) => Promise<McpOutcome>
  reconnect: (entryId: string, options?: McpReconnectOptions) => Promise<McpOutcome>
  setEnabled: (entryId: string, enabled: boolean) => Promise<McpOutcome>
}

/** Full component props assembled by the main slot renderer. */
export type McpPanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'mcpManager'>
  & InjectFace<McpPanelFace>
  & PropsStore<ReturnType<typeof createNavigationStore>>

/**
 * @param props - the main slot props.
 * @returns the panel.
 */
export function McpPanel(props: McpPanelProps): ReactNode {
  const { t, refresh } = props
  const snapshot = props.useCatalog(state => state)
  const view = props.useStore(state => state.view)
  const { openList, openServer, openCreate, openEdit } = props.actions
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<McpManagerLocaleKey | undefined>()
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setFormError(undefined); setSaving(false) }, [view])

  const submit = async (entryId: string | undefined, draft: McpServerDraft): Promise<void> => {
    setSaving(true)
    setFormError(undefined)
    const outcome = await (entryId === undefined ? props.create(draft) : props.update(entryId, draft))
    setSaving(false)
    if (outcome.kind === 'completed' && outcome.result.application !== 'failed') {
      const id = entryId ?? outcome.result.entryId
      if (id === undefined) openList()
      else openServer(id)
      return
    }
    setFormError(outcome.kind === 'unavailable' ? 'error.operationError' : outcome.errorKey)
  }

  const server = view.kind === 'server' || view.kind === 'edit'
    ? snapshot.servers.find(row => row.entryId === view.entryId)
    : undefined
  let body: ReactNode
  if (view.kind === 'list') {
    body = (
      <ServerList
        snapshot={snapshot} canToggle={props.canToggle} t={t} onOpen={openServer}
        onToggle={(entryId, enabled) => { void props.setEnabled(entryId, enabled) }}
        onRetry={() => { void refresh() }}
      />
    )
  } else if (view.kind === 'create') {
    body = (
      <ServerForm
        saving={saving} error={formError} t={t}
        onSubmit={(draft) => { void submit(undefined, draft) }} onCancel={openList}
      />
    )
  } else if (server === undefined) {
    body = (
      <div className={css.empty}>
        <p>{t(snapshot.phase === 'loading' ? 'loading' : 'error.notFound')}</p>
        <Button size="sm" variant="outline" onClick={openList}>{t('action.back')}</Button>
      </div>
    )
  } else if (view.kind === 'edit') {
    body = (
      <ServerForm
        view={server} saving={saving} error={formError} t={t}
        onSubmit={(draft) => { void submit(server.entryId, draft) }} onCancel={() => { openServer(server.entryId) }}
      />
    )
  } else {
    const last = snapshot.lastResult
    body = (
      <ServerDetail
        server={server} t={t} pending={snapshot.pending[server.entryId] !== undefined}
        warnings={last?.entryId === server.entryId ? last.warnings : []}
        onBack={openList} onEdit={() => { openEdit(server.entryId) }}
        onReconnect={acceptOrphan => props.reconnect(server.entryId, acceptOrphan ? { acceptOrphan: true } : undefined)}
        onRemove={() => props.remove(server.entryId)}
      />
    )
  }
  return (
    <div className={css.root} data-mcp-panel>
      {view.kind === 'list'
        ? (
          <div className={css.header}>
            <div>
              <h1 className={css.heading}>{t('title')}</h1>
              <p className={css.subtitle}>{t('subtitle')}</p>
            </div>
            <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={13} />} onClick={openCreate}>{t('add')}</Button>
          </div>
        )
        : null}
      {body}
    </div>
  )
}
