/**
 * Browser half: register the Activity page on the right Sidebar.
 *
 * The page reads the Session's Chat target, its `contextPressure` projection,
 * the client job rosters, and the Host's repository route; it keeps a clock
 * that runs only while a visible Turn is open and a rolling model speed
 * history, which it also provides as `activitySpeed`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ActivityPanel, type ActivityInjected } from './ActivityPanel.tsx'
import { ActivityTitle } from './ActivityTitle.tsx'
import { Config } from './config.ts'
import { fetchRepository } from './git-read.ts'
import { en, NS, zh } from './locales.ts'
import { createSpeedHistory, type SpeedStorage } from './speed.ts'

export type { ActivityInjected, ActivityPanelProps } from './ActivityPanel.tsx'
export type { ActivityKey } from './locales.ts'
export type { ActivitySpeed, SpeedExpectation } from './speed.ts'
export { Config } from './config.ts'

/** This implementation's identity in the tab system, and the key its body and title register under. */
const ACTIVITY_ID = '@deepseek-ai/dsh-client-ui-activity'

/** Guide position: after Files (10), Skills (15), Terminal (20), and Browser (30). */
const GUIDE_ORDER = 40

/**
 * The Activity page type: opened by kind from the guide, one page per pane.
 * @param t - namespace-bound translate, read on every label call.
 * @returns the definition to register.
 */
function activityDefinition(t: TranslateNS<'activity'>): SidebarRightTabDefinition {
  return {
    id: ACTIVITY_ID,
    kind: 'activity',
    priority: 'builtin',
    title: () => t('title'),
    guide: [{
      id: 'activity',
      order: GUIDE_ORDER,
      title: () => t('title'),
      description: () => t('guide.description'),
      icon: IconGaugeOutlineRegular,
    }],
  }
}

/** Required browser services: the tab registry and seats, copy, the Conversation assembly, and job rosters. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'uiConversation', 'jobs']

/** The browser's persistent storage, or undefined when access is blocked or absent. */
function browserStorage(): SpeedStorage | undefined {
  try {
    return globalThis.localStorage
  } catch (error) {
    // Blocked site data makes property access throw; the history then stays in memory.
    void error
    return undefined
  }
}

/**
 * Client plugin body: register the dictionaries, the page type, its body, and its chip title, and provide `activitySpeed`.
 * @param ctx - client root context.
 * @param config - git graph and speed history bounds; schemastery materializes every field before this runs.
 */
export function apply(ctx: ClientContext, config: Config = Config({})): void {
  const history = createSpeedHistory(config.speedSamples as number, config.speedMinBucketSamples as number, browserStorage())
  ctx.provide('activitySpeed', { expected: (model, atMs) => history.expected(model, atMs) })
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-activity: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(activityDefinition(t)), 'ui-activity: activity type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: ACTIVITY_ID,
      locale: NS,
      inject: (sessionId): ActivityInjected => ({
        hooks: { chat: ctx.uiConversation.binding(sessionId).target('chat'), jobs: ctx.jobs.state, speed: history.state },
        watchJobs: () => ctx.jobs.watchRows(sessionId),
        recordSpeed: (samples) => { history.record(samples) },
        loadGit: signal => fetchRepository(sessionId, config.gitCommits as number, signal),
        speedRecentRuns: config.speedRecentRuns as number,
      }),
    },
    ActivityPanel,
  )), 'ui-activity: activity tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: ACTIVITY_ID },
    ActivityTitle,
  )), 'ui-activity: activity tab title')
}
