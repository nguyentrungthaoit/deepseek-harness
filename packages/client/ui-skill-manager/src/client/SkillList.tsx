/**
 * Skills list page: header, an optional search field, Editable and Read-only
 * groups, and their cards.
 *
 * Each card has one button that opens the detail page; its `::after` covers
 * the card, and the insert button and Subagent switch sit above it, so no
 * interactive element nests inside another. Tab order per card is name,
 * insert, switch. The search field appears once the catalog lists more than
 * {@link SEARCH_THRESHOLD} skills and filters by name and description.
 */
import clsx from 'clsx'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconInfoOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular,
  IconSendOutlineRegular, Input, Switch, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SkillAvatar } from './SkillParts.tsx'
import { groupSkills } from './catalog.ts'
import type { CatalogSnapshot, ManagedSkill } from './catalog.ts'
import type { SkillManagerBodyProps } from './Panel.tsx'
import { useSubagentSwitch, type SubagentSwitchState } from './subagent-switch.ts'
import css from './Panel.module.css'

const SKELETON_ROWS = [0, 1, 2]

/** The list shows its search field only above this many skills. */
const SEARCH_THRESHOLD = 5

function matches(skill: ManagedSkill, query: string): boolean {
  return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
}

/**
 * The list page.
 * @param props - the body props and the current catalog snapshot.
 * @returns the header and the catalog's groups, skeleton, notice, or empty state.
 */
export function SkillList(props: SkillManagerBodyProps & { snapshot: CatalogSnapshot }): ReactNode {
  const { snapshot, t, reload, navigate, write, notify } = props
  const [search, setSearch] = useState('')
  const switchFor = useSubagentSwitch(write, notify)
  const empty = snapshot.skills.length === 0
  const loading = empty && (snapshot.status === 'idle' || snapshot.status === 'loading')
  const searchable = snapshot.skills.length > SEARCH_THRESHOLD
  const query = searchable ? search.trim().toLowerCase() : ''
  const shown = query === '' ? snapshot.skills : snapshot.skills.filter(skill => matches(skill, query))
  const groups = groupSkills(shown)
  const create = (): void => { navigate({ kind: 'create' }) }

  return (
    <>
      <div className={css.header}>
        <h2 className={css.title}>{t('type.label')}</h2>
        <Tooltip label={t('header.info')} openOnClick portal side="bottom" maxWidth={260}>
          <button type="button" className={css.iconButton} aria-label={t('header.about')}>
            <IconInfoOutlineRegular size={14} />
          </button>
        </Tooltip>
        <span className={css.spacer} />
        <Tooltip label={t('action.refresh')} portal side="bottom" disabled={loading}>
          <button type="button" className={css.iconButton} aria-label={t('action.refresh')} disabled={loading} onClick={reload}>
            <IconRefreshOutlineRegular size={14} />
          </button>
        </Tooltip>
        <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={14} />} onClick={create}>
          {t('action.create')}
        </Button>
      </div>
      {searchable && (
        <div className={css.search}>
          <Input
            type="search"
            className={clsx(css.input)}
            icon={<IconSearchOutlineRegular size={14} />}
            value={search}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onChange={(event) => { setSearch(event.target.value) }}
          />
        </div>
      )}
      <div className={css.body}>
        {loading && (
          <div className={css.skeleton} role="status" aria-label={t('loading')}>
            {SKELETON_ROWS.map(row => (
              <div key={row} className={css.skeletonRow} aria-hidden="true">
                <span className={`${css.cardIcon} ${css.skeletonFill}`} />
                <span className={css.skeletonLines}>
                  <span className={`${css.skeletonBar} ${css.skeletonName} ${css.skeletonFill}`} />
                  <span className={`${css.skeletonBar} ${css.skeletonFill}`} />
                </span>
              </div>
            ))}
          </div>
        )}
        {snapshot.status === 'error' && empty && (
          <div className={css.centered}>
            <p className={css.centeredText} role="alert">{t('error.load')}</p>
            <Button variant="outline" size="sm" onClick={reload}>{t('action.retry')}</Button>
          </div>
        )}
        {snapshot.status === 'error' && !empty && (
          <div className={css.notice} role="alert">
            <span className={css.noticeText}>{t('error.load')}</span>
            <button type="button" className={css.noticeAction} onClick={reload}>{t('action.retry')}</button>
          </div>
        )}
        {snapshot.status === 'ready' && empty && (
          <div className={css.centered}>
            <p className={css.centeredText}>{t('empty')}</p>
            <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular size={14} />} onClick={create}>
              {t('action.create')}
            </Button>
          </div>
        )}
        {!empty && shown.length === 0 && (
          <div className={css.centered}>
            <p className={css.centeredText} role="status">{t('search.empty')}</p>
          </div>
        )}
        <Group {...props} label={t('group.editable')} skills={groups.editable} switchFor={switchFor} />
        <Group {...props} label={t('group.readonly')} skills={groups.readonly} switchFor={switchFor} />
      </div>
    </>
  )
}

function Group({
  label, skills, switchFor, t, navigate, useInChat,
}: SkillManagerBodyProps & {
  label: string
  skills: readonly ManagedSkill[]
  switchFor: (skill: ManagedSkill) => SubagentSwitchState
}): ReactNode {
  if (skills.length === 0) return null
  return (
    <section className={css.group} aria-label={label}>
      <h3 className={css.groupTitle}>
        {label}
        <span className={css.groupCount}>{skills.length}</span>
      </h3>
      <ul className={css.cards}>
        {skills.map((skill) => {
          const state = switchFor(skill)
          const source = !skill.writable && skill.source !== ''
          return (
            <li key={skill.name} className={css.card}>
              <SkillAvatar name={skill.name} className={css.cardIcon} />
              <div className={css.cardMain}>
                <button
                  type="button"
                  className={css.cardOpen}
                  onClick={() => { navigate({ kind: 'detail', name: skill.name }) }}
                >
                  {skill.name}
                </button>
                <p className={css.cardDescription}>{skill.description}</p>
                {(source || state.checked) && (
                  <div className={css.chips}>
                    {source && <Tag tone="neutral" className={css.chip}>{skill.source}</Tag>}
                    {state.checked && <Tag tone="info">{t('badge.subagent')}</Tag>}
                  </div>
                )}
              </div>
              <div className={css.cardEnd}>
                <Tooltip label={t('action.insert', { name: skill.name })} portal side="bottom" align="end">
                  <button
                    type="button"
                    className={`${css.iconButton} ${css.insert}`}
                    aria-label={t('action.insert', { name: skill.name })}
                    onClick={() => { useInChat(skill.name) }}
                  >
                    <IconSendOutlineRegular size={14} />
                  </button>
                </Tooltip>
                {skill.writable && (
                  <Switch
                    className={css.toggle}
                    checked={state.checked}
                    disabled={state.busy}
                    label={t('toggle.subagent', { name: skill.name })}
                    onChange={state.toggle}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
