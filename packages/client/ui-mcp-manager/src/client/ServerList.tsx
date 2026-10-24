/** The MCP server rows: status, transport, ownership, tool count, and the enabled switch. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, StateDot, Switch, Tag, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpCatalogSnapshot } from './catalog.ts'
import css from './McpPanel.module.css'
import { ownershipKey, statusLabel, statusTone, transportKey, type Tone } from './presentation.ts'

/** Status tone to the dot state that draws it. */
export const DOT_STATE: Readonly<Record<Tone, StateDotState>> = {
  neutral: 'idle', progress: 'ongoing', success: 'done', warning: 'warning', danger: 'error',
}

/**
 * A server's initial on a tile whose hue is stable per name, so rows are told apart at a glance.
 * @param props.name - the server name.
 * @param props.size - `md` in list rows, `lg` in the detail header.
 * @returns the avatar tile.
 */
export function ServerAvatar(props: { name: string; size: 'md' | 'lg' }): ReactNode {
  let hash = 0
  for (const char of props.name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <span
      aria-hidden className={props.size === 'lg' ? css.avatarLg : css.avatar}
      style={{ '--mcp-avatar-hue': hash } as CSSProperties}
    >
      {props.name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Current time, re-read every second while `active`.
 * @param active - whether a countdown is showing.
 * @returns epoch milliseconds.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/**
 * @param props.snapshot - the catalog state.
 * @param props.canToggle - whether the enabled switch can reach the Host.
 * @param props.t - panel copy.
 * @param props.onOpen - opens a server's detail.
 * @param props.onToggle - sets a server's enabled state.
 * @param props.onRetry - lists again after a failure.
 * @returns the list, or its loading, failed, or empty state.
 */
export function ServerList(props: {
  snapshot: McpCatalogSnapshot
  canToggle: boolean
  t: TranslateNS<'mcpManager'>
  onOpen: (entryId: string) => void
  onToggle: (entryId: string, enabled: boolean) => void
  onRetry: () => void
}): ReactNode {
  const { snapshot, t } = props
  const now = useNow(snapshot.servers.some(server => server.status.state === 'backoff'))
  if (snapshot.phase === 'loading' && snapshot.servers.length === 0) return <p className={css.empty}>{t('loading')}</p>
  if (snapshot.phase === 'failed' && snapshot.servers.length === 0) {
    return (
      <div className={css.empty}>
        <p role="alert" className={css.error}>{t('loadFailed')}</p>
        <Button size="sm" variant="outline" onClick={props.onRetry}>{t('retry')}</Button>
      </div>
    )
  }
  if (snapshot.servers.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const row = (server: McpServerView): ReactNode => {
    const label = statusLabel(server.status, now)
    const pending = snapshot.pending[server.entryId] !== undefined
    const locked = !props.canToggle || server.ownership === 'readonly' || pending
    return (
      <li key={server.entryId} className={css.row}>
        <ServerAvatar name={server.serverName} size="md" />
        <button type="button" className={css.rowMain} onClick={() => { props.onOpen(server.entryId) }}>
          <span className={css.rowTitle}>
            <span className={css.name}>{server.serverName}</span>
            <Tag tone="neutral">{t(transportKey(server.transport))}</Tag>
            <Tag tone="outline">{t(ownershipKey(server.ownership))}</Tag>
          </span>
          <span className={css.rowStatus}>
            <StateDot state={DOT_STATE[statusTone(server.status)]} />
            <span>{t(label.key, label.params)}</span>
            <span className={css.dotSep} aria-hidden>·</span>
            <span>{server.tools.length === 1 ? t('toolCountOne') : t('toolCount', { count: server.tools.length })}</span>
          </span>
        </button>
        <Switch
          label={t('enabled')} checked={server.enabled} disabled={locked}
          title={props.canToggle ? undefined : t('toggleUnavailable')}
          onChange={(next) => { props.onToggle(server.entryId, next) }}
        />
      </li>
    )
  }
  return <ul className={css.list}>{snapshot.servers.map(row)}</ul>
}
