/**
 * Browser half: register the Skills page on the right Sidebar and its toast
 * on `shell.overlay`.
 *
 * The catalog refetches when the host forwards `skills/change`. Each session
 * keeps its own catalog and view; the toast store belongs to the registration,
 * so an outcome stays visible after the tab closes. This package does not read
 * or clear the slash-menu cache.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-typert-protocol'
import { SkillCatalog } from './catalog.ts'
import { SKILLS_ID, skillsDefinition } from './definition.tsx'
import { en, zh } from './locales.ts'
import { SkillManagerBody } from './Panel.tsx'
import type { SkillManagerInjected } from './Panel.tsx'
import { createSkillToastSource, SkillManagerToast } from './SkillToast.tsx'
import { SkillManagerTitle } from './Title.tsx'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Unfiltered skill-catalog invalidation forwarded from the host. No payload.
     * @mode emit
     */
    'skills/change'(): void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection {
    /** Host `skills/change`, forwarded with no payload. */
    'skills/change': true
  }
}

export type { SkillManagerBodyProps, SkillManagerInjected } from './Panel.tsx'
export type { SkillManagerKey } from './locales.ts'
export type { SkillView } from './navigation-store.ts'
export type { SkillToast, SkillToastKind, SkillToastProps } from './SkillToast.tsx'

/** This package's copy namespace. */
const NS = 'skillManager'

/** Required browser services: the tab registry, the keyed seat and overlay, skills, sessions, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.skills', 'sessions']

/**
 * Client plugin body: register the type, its dictionaries, its body, its toast, and its chip title.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const catalog = new SkillCatalog(ctx.remote.skills, id => ctx.sessions.binding(id) !== undefined)
  const toast = createSkillToastSource()
  ctx.effect(() => {
    const off = ctx.remote.$on('skills/change', () => { catalog.reloadAll() })
    return () => {
      off()
      catalog.dispose()
    }
  }, 'ui-skill-manager: catalog')
  ctx.effect(() => ctx.sidebarRightTabs.register(skillsDefinition(t)), 'ui-skill-manager: skills type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-manager: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: SKILLS_ID,
      locale: NS,
      inject: (sessionId): SkillManagerInjected => {
        const stores = catalog.source(sessionId)
        return {
          hooks: { catalog: stores.catalog, view: stores.view },
          navigate: (view) => { stores.view.set(view) },
          notify: toast.notify,
          write: draft => catalog.write(sessionId, draft),
          remove: (name, expectedVersion) => catalog.remove(sessionId, name, expectedVersion),
          reload: () => { void catalog.reload(sessionId) },
          useInChat: (name) => {
            const scope = ctx.sessions.binding(sessionId)?.ctx
            if (scope === undefined) return
            scope.emit('conversation/input-append-text', { text: `/${name} ` })
          },
        }
      },
    },
    SkillManagerBody,
  )), 'ui-skill-manager: skills tab body')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'skill-manager.toast',
    locale: NS,
    inject: () => ({ hooks: toast.hooks, dismiss: toast.dismiss }),
  }, SkillManagerToast)), 'ui-skill-manager: toast')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: SKILLS_ID },
    SkillManagerTitle,
  )), 'ui-skill-manager: skills tab title')
}
