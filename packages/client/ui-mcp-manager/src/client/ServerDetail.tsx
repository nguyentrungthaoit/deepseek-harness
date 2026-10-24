/** One MCP server: status, config summary, tools, warnings, and the reconnect, edit, and delete actions. */
import { useState, type ReactNode } from 'react'
import { Button, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpFieldView, McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpOutcome } from './catalog.ts'
import type { McpManagerLocaleKey } from './locales.ts'
import css from './McpPanel.module.css'
import { canReconnect, ownershipKey, statusLabel, statusTone, transportKey } from './presentation.ts'
import { DOT_STATE, useNow } from './ServerList.tsx'
import { ToolList } from './ToolList.tsx'

type T = TranslateNS<'mcpManager'>

/**
 * Show a stored value, or the source of the expression that computes it.
 * @param value - the stored field.
 * @param t - panel copy.
 * @returns display text; empty when absent.
 */
function fieldText(value: McpFieldView<string> | McpFieldView<string[]> | undefined, t: T): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return value.join(' ')
  if (typeof value === 'object') return t('form.expression', { source: value.expression })
  return value
}

/**
 * Map a failed outcome to its message key.
 * @param outcome - what the call returned.
 * @returns the locale key, absent when the call succeeded.
 */
function failure(outcome: McpOutcome): McpManagerLocaleKey | undefined {
  if (outcome.kind === 'unavailable') return 'error.operationError'
  return outcome.errorKey
}

/**
 * @param props.server - the row shown.
 * @param props.warnings - warnings of the last operation on this row.
 * @param props.pending - whether an operation on this row is in flight.
 * @param props.t - panel copy.
 * @param props.onBack - returns to the list.
 * @param props.onEdit - opens the edit form.
 * @param props.onReconnect - reconnects, with `acceptOrphan` after the confirmation.
 * @param props.onRemove - deletes the row.
 * @returns the detail page.
 */
export function ServerDetail(props: {
  server: McpServerView
  warnings: readonly string[]
  pending: boolean
  t: T
  onBack: () => void
  onEdit: () => void
  onReconnect: (acceptOrphan: boolean) => Promise<McpOutcome>
  onRemove: () => Promise<McpOutcome>
}): ReactNode {
  const { server, t } = props
  const [error, setError] = useState<McpManagerLocaleKey | undefined>()
  const [orphanPid, setOrphanPid] = useState<number | undefined>()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const now = useNow(server.status.state === 'backoff')
  const { status, config } = server
  const label = statusLabel(status, now)
  const reconnect = async (acceptOrphan: boolean): Promise<void> => {
    setError(undefined)
    const outcome = await props.onReconnect(acceptOrphan)
    if (outcome.kind === 'completed' && outcome.result.error?.code === 'orphan-unacknowledged') {
      setOrphanPid(outcome.result.error.orphanPid ?? 0)
      return
    }
    setOrphanPid(undefined)
    setError(failure(outcome))
  }
  const remove = async (): Promise<void> => {
    setConfirmingDelete(false)
    const outcome = await props.onRemove()
    const key = failure(outcome)
    if (key === undefined) props.onBack()
    else setError(key)
  }
  const lastError = status.state === 'backoff' || status.state === 'failed' ? status.lastError : undefined
  const orphan = status.state === 'failed' ? status.orphanPid : undefined
  const readOnlyNote = server.readOnlyReason === undefined
    ? undefined
    : server.readOnlyReason === 'management-required' ? 'readOnly.managementRequired' : 'readOnly.unaddressable'
  const secretField = config.transport === 'stdio' ? 'env' : 'headers'
  const secretRows = server.secrets.filter(secret => secret.path.length === 2 && secret.path[0] === secretField)
  return (
    <div className={css.section}>
      <div>
        <Button size="sm" variant="ghost" onClick={props.onBack}>{t('action.back')}</Button>
      </div>
      <div className={css.header}>
        <div className={css.section}>
          <h2 className={css.heading}>{server.serverName}</h2>
          <span className={css.meta}>
            <Tag>{t(transportKey(server.transport))}</Tag>
            <Tag tone="quiet">{t(ownershipKey(server.ownership))}</Tag>
          </span>
        </div>
        <div className={css.actions}>
          <Button size="sm" variant="outline" disabled={!canReconnect(status) || props.pending} onClick={() => { void reconnect(false) }}>
            {t('action.reconnect')}
          </Button>
          {server.ownership === 'readonly'
            ? null
            : <Button size="sm" variant="outline" disabled={props.pending} onClick={props.onEdit}>{t('action.edit')}</Button>}
          {server.ownership === 'profile'
            ? <Button size="sm" variant="outline" disabled={props.pending} onClick={() => { setConfirmingDelete(true) }}>{t('action.delete')}</Button>
            : null}
        </div>
      </div>
      {readOnlyNote === undefined ? null : <p className={css.hint}>{t(readOnlyNote)}</p>}
      {error === undefined ? null : <p role="alert" className={css.error}>{t(error)}</p>}
      <section className={css.section}>
        <span className={css.rowTitle}>
          <StateDot state={DOT_STATE[statusTone(status)]} />
          <span className={css.name}>{t(label.key, label.params)}</span>
        </span>
        {label.detail === undefined ? null : <p className={css.hint}>{t(label.detail.key)}</p>}
        {status.state === 'backoff'
          ? <p className={css.hint}>{t('attempt', { attempt: status.attempt, max: status.maxAttempts })}</p>
          : null}
        {lastError === undefined ? null : <p className={css.hint}>{t('lastError')}: {lastError}</p>}
        {orphan === undefined ? null : <p className={css.hint}>{t('orphan', { pid: orphan })}</p>}
      </section>
      <dl className={css.config}>
        <dt>{t('form.transport')}</dt>
        <dd>{t(transportKey(server.transport))}</dd>
        {config.transport === 'stdio'
          ? (
            <>
              <dt>{t('form.command')}</dt>
              <dd><code>{fieldText(config.command, t)}</code></dd>
              {config.args === undefined ? null : <><dt>{t('form.args')}</dt><dd><code>{fieldText(config.args, t)}</code></dd></>}
              {config.cwd === undefined ? null : <><dt>{t('form.cwd')}</dt><dd><code>{fieldText(config.cwd, t)}</code></dd></>}
            </>
          )
          : <><dt>{t('form.url')}</dt><dd><code>{fieldText(config.url, t)}</code></dd></>}
        {secretRows.length === 0
          ? null
          : (
            <>
              <dt>{t(config.transport === 'stdio' ? 'form.env' : 'form.headers')}</dt>
              <dd>
                <ul className={css.tools}>
                  {secretRows.map(secret => (
                    <li key={secret.path.join('.')}>
                      <code>{secret.path[1]}</code> {secret.set ? <span className={css.hint}>{t('form.secretStored')}</span> : null}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        {server.serverInfo === undefined
          ? null
          : <><dt>{t('serverInfo')}</dt><dd>{server.serverInfo.name} {server.serverInfo.version}</dd></>}
      </dl>
      <section className={css.section}>
        <h3 className={css.heading}>{t('tools')}</h3>
        <ToolList tools={server.tools} t={t} />
      </section>
      {props.warnings.length === 0
        ? null
        : (
          <section className={css.section}>
            <h3 className={css.heading}>{t('warnings')}</h3>
            <ul className={css.warnings}>{props.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </section>
        )}
      <Modal
        open={confirmingDelete} onClose={() => { setConfirmingDelete(false) }}
        title={t('confirmDelete.title')} description={t('confirmDelete.body', { name: server.serverName })}
        closeLabel={t('action.cancel')}
        footer={(
          <div className={css.actions}>
            <Button variant="ghost" onClick={() => { setConfirmingDelete(false) }}>{t('action.cancel')}</Button>
            <Button variant="primary" onClick={() => { void remove() }}>{t('confirmDelete.confirm')}</Button>
          </div>
        )}
      />
      <Modal
        open={orphanPid !== undefined} onClose={() => { setOrphanPid(undefined) }}
        title={t('confirmOrphan.title')} description={t('confirmOrphan.body', { pid: orphanPid ?? 0 })}
        closeLabel={t('action.cancel')}
        footer={(
          <div className={css.actions}>
            <Button variant="ghost" onClick={() => { setOrphanPid(undefined) }}>{t('action.cancel')}</Button>
            <Button variant="primary" onClick={() => { void reconnect(true) }}>{t('confirmOrphan.confirm')}</Button>
          </div>
        )}
      />
    </div>
  )
}
