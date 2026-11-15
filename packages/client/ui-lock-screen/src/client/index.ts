/**
 * Lock screen, browser half. A Lock button at the sidebar foot, the
 * `lockScreen.lock` shortcut, and a General Settings row cover the page with a
 * full-viewport scene, the pixel room or Matrix code rain as chosen in
 * Settings, that shows live agent status from every Session.
 * The first lock asks for a password; later locks ask for it to uncover the
 * page. The locked flag and a PBKDF2 verifier persist in localStorage, so a
 * reload and every tab of the origin stay locked. The lock only covers this
 * browser's page; it does not sign out or stop running agents.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { enterFullscreen } from './fullscreen.ts'
import { browserLockStorage, LOCK_STORAGE_KEY, LockController } from './lock-store.ts'
import { LockButton } from './LockButton.tsx'
import { LockOverlay } from './LockOverlay.tsx'
import { LockSettingsRow } from './LockSettingsRow.tsx'
import { en, NS, zh } from './locales.ts'
import { PASSWORD_ITERATIONS } from './password.ts'
import { LOCK_THEME_STORAGE_KEY, LockThemeController, type LockTheme } from './theme-store.ts'

export type { LockButtonInjected } from './LockButton.tsx'
export type { LockOverlayInjected, LockOverlayProps } from './LockOverlay.tsx'
export type { LockSettingsRowInjected } from './LockSettingsRow.tsx'
export type { LockPhase, LockState, LockStorage } from './lock-store.ts'
export type { LockTheme } from './theme-store.ts'
export type { LockScreenLocaleKey } from './locales.ts'
export { NS }

/** Shortcut command id; the binding is user-configurable. */
export const LOCK_COMMAND_ID = 'lockScreen.lock' as ShortcutCommandId

/** Required services. */
export const inject = ['slots', 'locale', 'shortcuts']

/**
 * Register the overlay, the sidebar button, the Settings row, and the shortcut.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new LockController(browserLockStorage(window, LOCK_STORAGE_KEY), PASSWORD_ITERATIONS)
  const theme = new LockThemeController(browserLockStorage(window, LOCK_THEME_STORAGE_KEY))
  ctx.effect(() => () => { controller.close(); theme.close() }, 'ui-lock-screen: cross-tab sync')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-lock-screen: dictionaries')
  const t = ctx.locale.bind(NS)
  // Every lock comes from a click or a shortcut, so the Matrix style may take full screen here.
  const lock = (): void => {
    controller.lock()
    if (theme.state.getSnapshot() === 'matrix') enterFullscreen(document)
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'lock-screen', locale: NS,
    inject: () => ({
      hooks: { lock: controller.state, theme: theme.state },
      check: (password: string) => controller.check(password),
      release: () => { controller.release() },
      setPassword: (password: string) => controller.setPassword(password),
      cancelSetup: () => { controller.cancelSetup() },
    }),
  }, LockOverlay))

  // Above Settings, the foot's only other control.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'lock-screen', locale: NS,
    inject: () => ({ lock }),
  }, LockButton))

  // After the appearance rows (10-11) and before developer tools (15).
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'lock-screen', order: 14, locale: NS,
    inject: () => ({
      hooks: { lock: controller.state, theme: theme.state }, lock,
      changePassword: () => { controller.changePassword() },
      removePassword: () => { controller.removePassword() },
      setTheme: (next: LockTheme) => { theme.set(next) },
    }),
  }, LockSettingsRow))

  ctx.effect(() => ctx.shortcuts.register({
    id: LOCK_COMMAND_ID, label: () => t('shortcut.lock'), aliases: ['lock', 'lock screen', 'afk'],
    defaults: {
      'desktop:macos': { code: 'KeyL', modifiers: ['primary', 'shift'] },
      'desktop:windows': { code: 'KeyL', modifiers: ['primary', 'shift'] },
      'desktop:linux': { code: 'KeyL', modifiers: ['primary', 'shift'] },
      'web:macos': { code: 'KeyL', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'KeyL', modifiers: ['primary', 'shift'] },
    },
    regions: ['page', 'editable', 'terminal'], modals: [],
    resolve: ({ modal }) => {
      if (modal !== null) return { status: 'blocked', reason: 'modal' }
      return { status: 'handled', run: lock }
    },
  }), 'ui-lock-screen: shortcut')
}
