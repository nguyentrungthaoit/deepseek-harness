---
description: "Pixel-art lock screen for the Web client: a sidebar Lock button, a shortcut, and a General settings row cover the page with an animated scene that shows live agent status until the local password is entered."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-lock-screen

English | [中文](README.zh.md)

## Summary

This package covers the Web page with a full-viewport pixel scene while you are away from the keyboard. The scene is a late-night developer room: a rainy window, a neon sign, monitors showing Java source, a JVM heap graph, and a Maven log, a server rack with Duke, and a cat that catches `NPE` bugs. Its HUD and status line show live agent activity from every Session. A Matrix style replaces the room with falling code rain and a terminal login. The page uncovers after the local password is entered. The lock covers this browser only; it does not sign out, and running agents keep working.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the browser row in the Web composition; it takes no config. The row needs the `slots`, `locale`, and `shortcuts` services, the sidebar's `sidebar.footer.action` seat, the layout's `shell.overlay` seat, and the General settings `settings.general.item` seat; the scene's status line reads the Session list and status sources of [`ui-session`](../ui-session/README.md).

### What to expect

Lock the page from the **Lock** button above Settings at the sidebar foot, from **Settings → General → Lock screen → Lock now**, or with the **Lock screen** shortcut (default Ctrl+Shift+L, or Cmd+Shift+L on macOS; the shortcut service accepts few Web bindings on Linux, so bind one there in the shortcut settings). The first lock asks for a password twice; later locks go straight to the scene.

The scene opens on a title screen. Any key or a click opens the password prompt; Esc returns to the title, and F toggles browser full screen. A wrong password shakes the dialog and prints a Java stack trace with the attempt count; the right one shows BUILD SUCCESS for about a second, then uncovers the page. The status line names one Session by precedence: one waiting for approval, then a running one, then one finished but unread, otherwise idle. The HUD counts running, waiting, and finished Sessions, and the developer types only while an agent runs.

**Settings → General → Lock screen** also picks the style: **Pixel room** (the default) or **Matrix**. The Matrix style fills the viewport with green katakana rain at device resolution and centers a terminal login: it types the agent status and opens straight on the password field, with no title screen, and Esc clears the field. Locking in this style also puts the browser in full screen, and the page leaves full screen when it uncovers; after a reload the first key or click restores it, since browsers allow full screen only from a user gesture. The rain falls faster while agents run, slower when all are idle, and some columns turn red while a Session waits for approval. A wrong password prints ACCESS DENIED with the attempt count; the right one shows ACCESS GRANTED before the page uncovers. Every tab of the origin follows the chosen style.

The pixel scene scales by whole multiples when the viewport allows, so a 2560x1440 full-screen display draws each scene pixel as a 4x4 block. The prompt, messages, and Session titles render as DOM text in the system font, so every locale and title displays.

A locked page stays locked after a reload, and locking or unlocking in one tab follows in every tab of the same origin. The Settings row also offers **Set password** or **Change password**, which asks for the new password twice and leaves the page uncovered, and **Remove password**, which forgets it so the next lock asks for a new one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`LockController`](src/client/lock-store.ts) owns one localStorage record under `dsh.lock-screen`: the locked flag and a PBKDF2-SHA256 verifier (salt, iteration count, digest) computed by [`password.ts`](src/client/password.ts) with `@noble/hashes`, which also runs on plain-HTTP origins where WebCrypto's `subtle` is unavailable. The record is parsed and validated on every read; a malformed record reads as unlocked without a password. Other tabs follow through the `storage` event. The overlay checks a password without changing state, then releases the lock after the success message, so the scene can show it.

[`LockOverlay`](src/client/LockOverlay.tsx) is the `shell.overlay` entry. While locked it portals an `aria-modal` dialog with `data-shortcut-modal="lock-screen"` into the document body, so the shortcut service blocks application commands, and [`useModalLayer`](../ui-primitives/src/useModalLayer.ts) owns focus and Esc. [`PixelScene`](src/client/scene.ts) advances in fixed 60 Hz steps from `requestAnimationFrame` and paints a 640x360 canvas with the 3x5 bitmap font in [`pixel-font.ts`](src/client/pixel-font.ts), so the scene needs no web font. [`LockThemeController`](src/client/theme-store.ts) keeps the style under its own `dsh.lock-screen.theme` key; [`MatrixRain`](src/client/matrix.ts) steps the code rain at the same 60 Hz and paints it with `fillText` on a canvas sized to the viewport in device pixels, and [`MatrixOverlay.module.css`](src/client/MatrixOverlay.module.css) mirrors the pixel dialog's class names, so both styles render one dialog tree. [`fullscreen.ts`](src/client/fullscreen.ts) wraps the Fullscreen API and ignores refused requests, since the overlay covers the viewport either way. [`summarizeAgents`](src/client/agent-status.ts) derives the status line and counts from the Session list and `SessionStatusSnapshot`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-session](../ui-session/README.md) — the Session list and status sources the status line reads.
- [shortcuts](../shortcuts/README.md) — command registration, rebinding, and modal blocking.
- [ui-sidebar](../ui-sidebar/README.md) — the sidebar foot that declares `sidebar.footer.action`.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the lock screen is browser chrome and neither the password nor the status display reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The lock is a privacy cover for one browser, so its limits follow from staying client-side.

- **The lock hides the page; it is not access control.** Anyone with the browser profile can clear site data or call the Host directly; use the Host's authentication to keep others out.
- **A forgotten password needs cleared site data.** Remove the `dsh.lock-screen` localStorage entry for the origin, then reload.
- **The scene's art text is English.** Neon, HUD, monitor, and stack-trace text is part of the artwork; the prompt, hints, and status lines follow the locale.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
