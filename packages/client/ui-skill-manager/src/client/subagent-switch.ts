/**
 * The Subagent switch's write, shared by list cards and the detail page.
 *
 * The switch shows the requested state while its write is in flight and
 * refuses input until it settles. A failed write drops that request, so the
 * switch returns to the listed value; either outcome reaches the toast.
 */
import { useState } from 'react'
import type { ManagedSkill } from './catalog.ts'
import type { SkillManagerInjected } from './Panel.tsx'
import { failureToast } from './SkillToast.tsx'

/** One row's switch state and its toggle. */
export interface SubagentSwitchState {
  readonly checked: boolean
  readonly busy: boolean
  readonly toggle: (next: boolean) => void
}

/**
 * Bind Subagent switches to the catalog write and the toast.
 * @param write - the session's write; called without `body` so the host keeps it.
 * @param notify - the app-wide toast report.
 * @returns the switch state of one row.
 */
export function useSubagentSwitch(
  write: SkillManagerInjected['write'],
  notify: SkillManagerInjected['notify'],
): (skill: ManagedSkill) => SubagentSwitchState {
  const [requested, setRequested] = useState<ReadonlyMap<string, boolean>>(new Map())
  return skill => ({
    checked: requested.get(skill.name) ?? skill.subagent,
    busy: requested.has(skill.name),
    toggle: (next) => {
      setRequested(current => new Map(current).set(skill.name, next))
      void write({
        name: skill.name,
        description: skill.description,
        subagent: next,
        ...skill.version === undefined ? {} : { expectedVersion: skill.version },
      }).then((failure) => {
        setRequested((current) => {
          const rest = new Map(current)
          rest.delete(skill.name)
          return rest
        })
        notify(failure === undefined
          ? { kind: next ? 'subagentOn' : 'subagentOff', name: skill.name }
          : failureToast('saveFailed', skill.name, failure))
      })
    },
  })
}
