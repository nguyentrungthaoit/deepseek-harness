/**
 * One skill's detail page: a header with the name, description, source and
 * Subagent chips, and the actions; then the rendered content, the source, and
 * the Subagent switch. Every row offers Use in chat; writable rows add Edit
 * and Delete.
 *
 * Delete asks first in a modal and sends the row's file version. A failed
 * delete keeps the page and reports through the toast.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconChevronLeftOutlineRegular, IconEditOutlineRegular, IconSendOutlineRegular,
  IconTrashOutlineRegular, Modal, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ManagedSkill } from './catalog.ts'
import type { SkillManagerBodyProps } from './Panel.tsx'
import { useSubagentSwitch } from './subagent-switch.ts'
import { failureToast } from './SkillToast.tsx'
import { SkillAvatar, SkillDocument, SubagentRow } from './SkillParts.tsx'
import css from './Panel.module.css'

/**
 * The detail page.
 * @param props - the body props and the listed skill.
 * @returns the page with its delete confirmation.
 */
export function SkillDetail({
  skill, t, navigate, remove, useInChat, write, notify,
}: SkillManagerBodyProps & { skill: ManagedSkill }): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const subagent = useSubagentSwitch(write, notify)(skill)
  const unreadable = skill.body === undefined

  const confirmDelete = (): void => {
    setDeleting(true)
    void remove(skill.name, skill.version).then((failure) => {
      setDeleting(false)
      setConfirming(false)
      if (failure !== undefined) {
        notify(failureToast('deleteFailed', skill.name, failure))
        return
      }
      notify({ kind: 'deleted', name: skill.name })
      navigate({ kind: 'list' })
    })
  }

  return (
    <>
      <div className={css.header}>
        <button type="button" className={css.crumb} onClick={() => { navigate({ kind: 'list' }) }}>
          <IconChevronLeftOutlineRegular size={14} />
          {t('type.label')}
        </button>
      </div>
      <div className={css.body}>
        <div className={css.hero}>
          <div className={css.heroHead}>
            <SkillAvatar name={skill.name} className={css.heroIcon} />
            <div className={css.heroTitle}>
              <h2 className={css.heroName}>{skill.name}</h2>
              <div className={css.chips}>
                {skill.source !== '' && <Tag tone="neutral" className={css.chip}>{skill.source}</Tag>}
                <Tag tone={subagent.checked ? 'info' : 'outline'}>
                  {t(subagent.checked ? 'chip.subagentOn' : 'chip.subagentOff')}
                </Tag>
              </div>
            </div>
          </div>
          <p className={css.heroDescription}>{skill.description}</p>
          <div className={css.heroActions}>
            <Button
              variant="primary"
              size="sm"
              icon={<IconSendOutlineRegular size={14} />}
              onClick={() => { useInChat(skill.name) }}
            >
              {t('action.use')}
            </Button>
            {skill.writable && (
              <>
                <Tooltip label={t('body.unreadable')} portal side="bottom" disabled={!unreadable}>
                  <span className={css.tooltipAnchor}>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<IconEditOutlineRegular size={14} />}
                      disabled={unreadable}
                      onClick={() => { navigate({ kind: 'edit', name: skill.name }) }}
                    >
                      {t('action.edit')}
                    </Button>
                  </span>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  className={css.danger}
                  icon={<IconTrashOutlineRegular size={14} />}
                  onClick={() => { setConfirming(true) }}
                >
                  {t('action.delete')}
                </Button>
              </>
            )}
          </div>
        </div>
        {skill.writable && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('section.body')}</h3>
            {unreadable
              ? <p className={`${css.document} ${css.muted}`}>{t('body.unreadable')}</p>
              : <SkillDocument text={skill.body} t={t} />}
          </section>
        )}
        {(skill.source !== '' || skill.path !== undefined) && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('section.source')}</h3>
            <div className={css.panelCard}>
              {skill.source !== '' && <p className={css.sectionText}>{skill.source}</p>}
              {skill.path !== undefined && <p className={css.path}>{skill.path}</p>}
            </div>
          </section>
        )}
        {skill.writable && (
          <section className={`${css.section} ${css.panelCard}`}>
            <SubagentRow
              label={t('toggle.subagent', { name: skill.name })}
              checked={subagent.checked}
              disabled={subagent.busy}
              onChange={subagent.toggle}
              t={t}
            />
          </section>
        )}
      </div>
      <Modal
        open={confirming}
        onClose={() => { if (!deleting) setConfirming(false) }}
        title={t('confirm.title', { name: skill.name })}
        description={t('confirm.description', { name: skill.name })}
        closeLabel={t('action.close')}
        footer={(
          <>
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => { setConfirming(false) }}>
              {t('action.cancel')}
            </Button>
            <Button size="sm" className={css.dangerSolid} disabled={deleting} onClick={confirmDelete}>
              {t('confirm.action')}
            </Button>
          </>
        )}
      />
    </>
  )
}
