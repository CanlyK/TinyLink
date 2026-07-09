# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TinyLink is an Electron desktop app. It shows a small control-panel window (a "Connect" form with your code and a friend's code) plus a separate always-on-top, transparent "character" avatar that floats in the top-right corner of the screen and animates in reaction to the user's global keyboard and mouse activity.

The linking feature is implemented: each running instance gets a short pairing code from **TinyLinkServer** (a sibling repo, a socket.io relay — see `../TinyLinkServer`). Enter a friend's code in the Connect form to pair; once paired, a second always-on-top **peer window** shows the friend's avatar reacting to *their* activity in real time. See "Networking layer" below.

## Commands

- `npm start` — launch the app (`electron .`). Works out of the box: by default it connects to the **live** deployed TinyLinkServer at `https://tinylinkserver-d1vl.onrender.com` (no env vars needed).
- To point elsewhere (e.g. a local server for testing), set the `TINYLINK_SERVER_URL` env var before launching, e.g. `TINYLINK_SERVER_URL=http://localhost:8080 npm start` (PowerShell: `$env:TINYLINK_SERVER_URL='http://localhost:8080'; npm start`). Run a local server with `cd ../TinyLinkServer && npm install && npm start`.
- The default URL is defined by the `SERVER_URL` constant in `network.js`.
- On startup the main-process console logs the connection (`[network] connecting to …`, `[network] connected …`, `[network] registered — your code is XXXXXX`); a `[network] connect_error …` line means it couldn't reach the server and is retrying.
- Debugging: use the VS Code launch config in `launch.json` (the **Main + renderer** compound). It starts the main process with `--remote-debugging-port=9222` and attaches a Chrome debugger to the renderer. Note this file lives at the repo root; VS Code normally expects it at `.vscode/launch.json`.
- No tests or linter are configured (`npm test` is a placeholder that exits 1).

## Building distributables

Packaging is handled by **electron-builder** (dev dependency; config lives in the
`"build"` field of `package.json`).

- `npm run dist` — build installers for the **current OS** into `dist/`. On
  Windows this produces an NSIS installer, `dist/TinyLink Setup <version>.exe`
  (double-click to install; friends need no Node/git/terminal). On macOS it
  produces `dist/TinyLink-<version>.dmg`.
- `npm run pack` — faster `--dir`-only build (no installer) into
  `dist/<platform>-unpacked/` for quick local testing.
- **Cross-platform note:** a target can only be built on its own OS. The `.dmg`
  must be built on a Mac (or CI); running `npm run dist` on Windows only emits
  the `.exe`. The `mac`/`win` blocks in the config both exist so either machine
  Just Works.
- **Server URL is baked in automatically.** There is no build-time injection:
  `network.js`'s `SERVER_URL` default (the live Render URL) is plain source that
  gets packed into `app.asar`, so the installed app connects to the deployed
  server with zero config. `TINYLINK_SERVER_URL` still overrides at runtime if a
  user sets it, but a normal user never does.
- **Native module:** `uiohook-napi` is rebuilt against Electron's ABI by
  electron-builder and unpacked from the asar via the `asarUnpack` config (a
  native `.node` binary can't be loaded from inside an asar archive).
- **Icon:** `build/icon.png` (1024×1024 placeholder, generated from the character
  sprite). electron-builder auto-generates the Windows `.ico` / macOS `.icns`
  from it. Replace this file to rebrand.
- **Code signing** is not configured. Unsigned builds trigger a
  SmartScreen/Gatekeeper warning on first run (user clicks through: "More info →
  Run anyway" on Windows; right-click → Open on macOS). Signing certificates cost
  money and are optional for a hobby project — skip for now; revisit only if
  distributing widely.
- `dist/` is gitignored (build output is not committed).

## Architecture

Standard Electron three-layer split (main / preload / renderer), with **three** BrowserWindows driven from a single `main.js`:

- **`main.js`** (main process) — creates all windows and owns all OS-level input capture. It uses `uiohook-napi` (`uIOhook`) to listen for *global* key/mouse events (system-wide, even when the app is unfocused). For each event it (1) forwards the raw event to the character window over IPC channels `global-keydown`/`global-keyup`/`global-mousedown`/`global-mouseup` (local-only, fine to be raw), and (2) relays an **abstract** signal to the paired peer via `network.sendInput(...)` (see privacy note). `uIOhook.start()` runs on app ready and `uIOhook.stop()` on window-all-closed. It also owns the networking callbacks, the `link:*` / `widget:hover` IPC, per-window mouse click-through state, and always-on-top enforcement (see "Window interaction").
  - `mainWindow` → `index.html`: the frameless 380×355 control panel.
  - `characterWindow` → `character.html`: your avatar. Frameless, transparent, always-on-top, 140×140, top-right of the work area.
  - `peerWindow` → `peer.html`: the friend's avatar. Same style, created hidden and shown only while paired, positioned just left of your character.

- **`identity.js`** (main process) — persists this install's `{ clientId, code }` as JSON in `app.getPath('userData')/identity.json` so the pairing code is **stable across restarts** (see "Networking layer"). `load()` creates it on first run; `setCode()` persists a server-corrected code.

- **`fullscreen.js`** (main process) — detects whether a *foreign* fullscreen app (e.g. a game) is active and reports transitions via `start(onChange)` / `stop()`. See "Window interaction" below. Exports the pure `coversDisplay(winBounds, displayBounds)` geometry test for unit testing.

- **`network.js`** (main process) — the networking layer. Wraps a `socket.io-client` connection to TinyLinkServer. The target is the `SERVER_URL` constant: `process.env.TINYLINK_SERVER_URL` if set, otherwise the live deployment `https://tinylinkserver-d1vl.onrender.com`. Because the default URL is `https://`, socket.io upgrades the WebSocket transport to `wss://` (secure) automatically — verified: initial `polling` transport upgrades to `websocket` over TLS. Exposes `start({onCode,onStatus,onPeerInput})`, `pairWith(code)`, and `sendInput(event, button?)`. socket.io handles reconnection/backoff. `sendInput` is the **only** outbound input path and accepts only the abstract event names `key-down`/`key-up`/`mouse-down`/`mouse-up` plus an optional integer mouse button.

- **`preload.js`** — the security bridge, shared by all three windows. Via `contextBridge` it exposes:
  - `window.input` (`onKeyDown/onKeyUp/onMouseDown/onMouseUp`) — your local global input, consumed by `character.js`.
  - `window.link` (`pair`, `requestState`, `onCode`, `onStatus`) — the control panel's channel to the networking layer.
  - `window.peer` (`onKeyDown/onKeyUp/onMouseDown/onMouseUp`, `onReset`) — the friend's abstract input, consumed by `peer.js`.
  - `window.widget` (`setHover`) — avatar renderers report whether the cursor is over the drag hitbox (see "Window interaction").
  Renderer code never touches `ipcRenderer` directly.

- **Renderers**:
  - `character.js` (`character.html`) — tracks `keyDown`/`mouseDown` from `window.input` and swaps `document.body`'s background among the four `assets/character*.png` sprites. Also reports cursor-over-`#hitbox` via `window.widget.setHover`.
  - `peer.js` (`peer.html`, `stylePeer.css`) — the same animation logic driven by `window.peer`; styled with a blue glow + "friend" badge to distinguish it from your own avatar. Resets to idle on `onReset` (peer disconnect). Also reports hover like `character.js`.
  - `connect.js` (`index.html` + `style.css`) — the control panel. Displays your code (readonly), sends the friend's code via `window.link.pair`, and shows connection/pairing status in `#status`.

## Networking layer & pairing

Pairing/relay is handled by **TinyLinkServer** (`../TinyLinkServer`, a socket.io relay). Flow: on every (re)connect the client emits `register { clientId, code }` with its **persisted** identity (`identity.js`); the server confirms it via `registered { code }` → `window.link.onCode`. Entering a friend's code emits `pair`; the server cross-links the two and emits `paired` to both; thereafter each side's abstract `input` signals are relayed to the other as `peer-input`, which `main.js` routes to `peerWindow`. Edge cases surfaced in the status line: `invalid-code`, `self-pair`, `peer-busy`, server offline (auto-reconnect), and peer disconnect. Full protocol table lives in `../TinyLinkServer/README.md`.

**Persistent codes across restarts.** The code is **not** re-randomized each launch. `identity.js` persists `{ clientId, code }` in userData; the client generates the code on first run and sends it on `register`. The server honors the requested code, using `clientId` to let the same install *reclaim* its code after a reconnect/restart even if its old socket is briefly still connected, and only mints a fresh code on a genuine cross-machine collision (the client then persists whatever code the server confirms). **This required a server change** — the old server auto-assigned a new random code in `io.on('connection')` and had no `register` handler; a deployed server must be redeployed with the new logic for persistence to take effect.

## Window interaction: drag & fullscreen click-through

**Dragging.** The control panel is draggable via `-webkit-app-region: drag` on
`.window`, with the code inputs and Connect button marked `no-drag`.

The **avatar windows** are subtler: the window is transparent 140×140 but the
visible sprite only occupies a smaller area (measured opaque bounds ≈ x 26–82%,
y 40–78% of the image). So the drag region is a `#hitbox` element sized to that
sprite area (`styleCharacter.css` / `stylePeer.css`) — **not** the whole window.
Everything outside the hitbox is click-through: each avatar renderer tracks
whether the cursor is over `#hitbox` (`window.widget.setHover`), and `main.js`
sets `win.setIgnoreMouseEvents(!overHitbox, { forward: true })` so only the
visible sprite is grabbable and the transparent padding passes clicks through.
`forward: true` keeps `mousemove` flowing even while click-through, which is how
the renderer notices the cursor entering the hitbox. If you re-crop the sprites,
re-measure and update the hitbox insets.

**Fullscreen click-through.** When another app is running fullscreen (a game),
the avatar windows stay *visible* but become fully click-through so clicks/drags
pass to the game. `fullscreen.js` polls the foreground window (~1s) via
`get-windows` and calls back on transitions. `main.js` combines this with the
hitbox state — a window ignores the mouse when `fullscreenActive || !overHitbox`
(`updateMouseIgnore`) — so fullscreen forces click-through regardless of cursor
position. Leaving fullscreen restores normal hitbox behavior. The peer window
inherits the current state when it appears mid-game.

**Always-on-top hardening.** The avatars are created `alwaysOnTop`, but the
default `'floating'` level is weak (especially on macOS). `main.js`
(`enforceAlwaysOnTop`) raises them to the `'screen-saver'` level, re-asserts on
each window's `blur` and on a 2s interval (some OS/window managers silently drop
always-on-top), and on **macOS** also calls
`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` so the widget
stays visible across Spaces and other apps' fullscreen. Platform note: on
**Windows** `'floating'` is already `HWND_TOPMOST` and usually holds, so the
level bump mainly helps **macOS**; the periodic re-assert helps both. This is why
a widget can stay on top for one user (Windows) but slip behind for another (Mac).

- **Detection heuristic:** a foreign window is "fullscreen" if it covers its whole
  monitor **and** its origin sits at the monitor's top-left corner. The origin
  check distinguishes *fullscreen* (origin ≈ 0,0) from merely *maximized* (Windows
  inflates a maximized window to a slightly-negative origin like −7,−7). This
  catches borderless-windowed fullscreen (what most games use), and is
  DPI-robust (origin ≈ 0 in both physical and DIP space; coverage is a `>=` test)
  — verified against a real HiDPI maximized window.
- **Why polling:** there is no cross-platform OS/Electron event for a *foreign*
  app entering fullscreen (Electron's `enter-full-screen` fires only for our own
  windows). Poll interval is 1s.
- **Platform notes:** works without special permission on Windows. On macOS,
  querying other apps' windows requires the user to grant **Screen Recording**
  permission; if `get-windows` throws (e.g. permission denied), detection
  degrades gracefully to "not fullscreen" and the widgets simply stay
  interactive. (Windows-only alternative considered: `SHQueryUserNotificationState`
  → `QUNS_BUSY`; rejected because it misses borderless-windowed games and needs a
  native call.)
- **Does NOT touch uiohook.** This only toggles mouse handling on the avatar
  windows. Global input capture is a separate system and keeps working regardless
  of focus, so the avatars still *react* to input during a game.

## Privacy constraint (do not weaken)

`uiohook-napi` captures **raw, system-wide** key/mouse events. When relaying to a paired peer, TinyLink sends **only abstract event signals** — `key-down`, `key-up`, `mouse-down`, `mouse-up`, plus an optional integer mouse button — and **never** key codes, typed characters, or cursor coordinates. This is enforced structurally, not as an afterthought: `network.sendInput` and the server's `input` handler both validate against a fixed allow-list and construct a fresh `{ event, button }` object, so raw fields cannot ride along. The friend should see "they're typing/clicking", never *what* was typed or where the mouse is. Do not add fields/events that could carry raw input, and never pass the raw `uIOhook` event into `network.js`. The matching constraint is documented in `../TinyLinkServer/CLAUDE.md`.

## Conventions

- CommonJS modules (`require`, `"type": "commonjs"`).
- CSS uses a `:root` custom-property palette (pinks/coral/blue) and the "Short Stack" Google Font; reuse these variables rather than hardcoding colors.
- Asset images live in `assets/`.
