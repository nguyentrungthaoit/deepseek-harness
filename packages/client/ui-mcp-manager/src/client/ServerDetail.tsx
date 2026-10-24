/** One MCP server: status, config summary, tools, warnings, and the reconnect, edit, and delete actions. */
import { useState, type ReactNode } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconEditOutlineRegular, IconRefreshOutlineRegular,
  IconTrashOutlineRegular, Modal, StateDot, Tag, type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpFieldView, McpServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpOutcome } from './catalog.ts'
import type { McpManagerLocaleKey } from './locales.ts'
import css from './McpPanel.module.css'
import { canReconnect, ownershipKey, statusLabel, statusTone, transportKey, type Tone } from './presentation.ts'
import { DOT_STATE, ServerAvatar, useNow } from './ServerList.tsx'
import { ToolList } from './ToolList.tsx'

type T = TranslateNS<'mcpManager'>

/** Status tone to the tag tint that frames the status chip. */
const TAG_TONE: Readonly<Record<Tone, TagTone>> = {
  neutral: 'neutral', progress: 'info', success: 'success', warning: 'warning', danger: 'danger',
}

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
  const tone = statusTone(status)
  const configRow = (key: McpManagerLocaleKey, value: ReactNode): ReactNode => (
    <div className={css.configRow}>
      <dt>{t(key)}</dt>
      <dd>{value}</dd>
    </div>
  )
  const stat = (key: McpManagerLocaleKey, value: ReactNode): ReactNode => (
    <div className={css.stat}>
      <span className={css.statLabel}>{t(key)}</span>
      <span className={css.statValue}>{value}</span>
    </div>
  )
  return (
    <div className={css.detail}>
      <div>
        <button type="button" className={css.crumb} onClick={props.onBack}>
          <IconChevronLeftOutlineRegular size={14} />
          {t('action.back')}
        </button>
      </div>
      <div className={css.hero} data-tone={tone}>
        <div className={css.heroTop}>
          <div className={css.heroHead}>
            <ServerAvatar name={server.serverName} size="lg" />
            <div className={css.heroTitle}>
              <h2 className={css.heroName}>{server.serverName}</h2>
              <span className={css.meta}>
                <Tag tone={TAG_TONE[tone]}>
                  <span className={css.tagStatus}>
                    <StateDot state={DOT_STATE[tone]} />
                    {t(label.key, label.params)}
                  </span>
                </Tag>
                <Tag tone="outline">{t(ownershipKey(server.ownership))}</Tag>
              </span>
            </div>
          </div>
          <div className={css.heroActions}>
            <Button
              size="sm" variant="outline" icon={<IconRefreshOutlineRegular size={14} />}
              disabled={!canReconnect(status) || props.pending} onClick={() => { void reconnect(false) }}
            >
              {t('action.reconnect')}
            </Button>
            {server.ownership === 'readonly'
              ? null
              : (
                <Button size="sm" variant="outline" icon={<IconEditOutlineRegular size={14} />} disabled={props.pending} onClick={props.onEdit}>
                  {t('action.edit')}
                </Button>
              )}
            {server.ownership === 'profile'
              ? (
                <Button
                  size="sm" variant="outline" className={css.danger} icon={<IconTrashOutlineRegular size={14} />}
                  disabled={props.pending} onClick={() => { setConfirmingDelete(true) }}
                >
                  {t('action.delete')}
                </Button>
              )
              : null}
          </div>
        </div>
        <div className={css.stats}>
          {stat('tools', server.tools.length)}
          {stat('form.transport', t(transportKey(server.transport)))}
          {stat('serverInfo', server.serverInfo === undefined ? '—' : `${server.serverInfo.name} ${server.serverInfo.version}`)}
        </div>
      </div>
      {readOnlyNote === undefined ? null : <p className={css.notice}>{t(readOnlyNote)}</p>}
      {error === undefined ? null : <p role="alert" className={`${css.notice} ${css.noticeDanger}`}>{t(error)}</p>}
      {label.detail === undefined && status.state !== 'backoff' && lastError === undefined && orphan === undefined
        ? null
        : (
          <div className={`${css.notice} ${tone === 'danger' ? css.noticeDanger : css.noticeWarning}`}>
            {label.detail === undefined ? null : <p className={css.noticeTitle}>{t(label.detail.key)}</p>}
            {status.state === 'backoff'
              ? <p className={css.noticeLine}>{t('attempt', { attempt: status.attempt, max: status.maxAttempts })}</p>
              : null}
            {lastError === undefined ? null : <p className={css.noticeLine}>{t('lastError')}: {lastError}</p>}
            {orphan === undefined ? null : <p className={css.noticeLine}>{t('orphan', { pid: orphan })}</p>}
          </div>
        )}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.config')}</h3>
        <dl className={`${css.card} ${css.config}`}>
          {config.transport === 'stdio'
            ? (
              <>
                {configRow('form.command', <code className={css.code}>{fieldText(config.command, t)}</code>)}
                {config.args === undefined ? null : configRow('detail.args', <code className={css.code}>{fieldText(config.args, t)}</code>)}
                {config.cwd === undefined ? null : configRow('form.cwd', <code className={css.code}>{fieldText(config.cwd, t)}</code>)}
              </>
            )
            : configRow('form.url', <code className={css.code}>{fieldText(config.url, t)}</code>)}
          {secretRows.length === 0
            ? null
            : configRow(config.transport === 'stdio' ? 'form.env' : 'form.headers', (
              <ul className={css.secrets}>
                {secretRows.map(secret => (
                  <li key={secret.path.join('.')} className={css.secret}>
                    <code className={css.code}>{secret.path[1]}</code>
                    {secret.set ? <span className={css.stored}>{t('detail.secretStored')}</span> : null}
                  </li>
                ))}
              </ul>
            ))}
        </dl>
      </section>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          {t('tools')}
          <span className={css.count}>{server.tools.length}</span>
        </h3>
        <ToolList tools={server.tools} t={t} />
      </section>
      {props.warnings.length === 0
        ? null
        : (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('warnings')}</h3>
            <ul className={`${css.notice} ${css.noticeWarning} ${css.warnings}`}>
              {props.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          </section>
        )}
      <Modal
        open={confirmingDelete} onClose={() => { setConfirmingDelete(false) }}
        title={t('confirmDelete.title')} description={t('confirmDelete.body', { name: server.serverName })}
        closeLabel={t('action.cancel')}
        footer={(
          <div className={css.actions}>
            <Button variant="ghost" onClick={() => { setConfirmingDelete(false) }}>{t('action.cancel')}</Button>
            <Button className={css.dangerSolid} onClick={() => { void remove() }}>{t('confirmDelete.confirm')}</Button>
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
