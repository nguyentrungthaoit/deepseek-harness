/**
 * Stage one of this package's registration: what the skills tab type is.
 *
 * The type is a page. It claims no address. The guide offers it as an entry.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconDeliverDocRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const SKILLS_KIND = 'skills'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const SKILLS_ID = '@deepseek-ai/dsh-client-ui-skill-manager'

/**
 * The skills type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function skillsDefinition(t: TranslateNS<'skillManager'>): SidebarRightTabDefinition {
  return {
    id: SKILLS_ID,
    kind: SKILLS_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'skills',
      order: 15,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconDeliverDocRegular,
    }],
  }
}
