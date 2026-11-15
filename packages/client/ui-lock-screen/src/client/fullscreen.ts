/**
 * Browser full screen for the lock screen. The overlay already covers the
 * viewport, so a refused request only leaves the browser chrome visible and
 * is ignored.
 */

/**
 * Put the page in full screen unless it already is or the browser cannot.
 * @param document - page document; call from a user gesture.
 */
export function enterFullscreen(document: Document): void {
  if (document.fullscreenElement || !document.fullscreenEnabled) return
  document.documentElement.requestFullscreen().catch((error: unknown) => {
    // Refused without a user gesture or by policy; the overlay still covers the page.
    void error
  })
}

/**
 * Leave full screen when the page is in it.
 * @param document - page document.
 */
export function exitFullscreen(document: Document): void {
  if (!document.fullscreenElement) return
  document.exitFullscreen().catch((error: unknown) => {
    // The browser already left full screen.
    void error
  })
}

/**
 * Enter full screen, or leave it when the page is in it.
 * @param document - page document; call from a user gesture.
 */
export function toggleFullscreen(document: Document): void {
  if (document.fullscreenElement) exitFullscreen(document)
  else enterFullscreen(document)
}
