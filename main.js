// Imports app and BrowserWindow Electron modules
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const { uIOhook } = require('uiohook-napi');
const path = require('path');
const network = require('./network');
const fullscreen = require('./fullscreen');
const identity = require('./identity');
const settings = require('./settings');
const debug = require('./debuglog');

let mainWindow;
let characterWindow;
let peerWindow;
let myIdentity;             // { clientId, code } persisted across restarts
let prefs;                  // { characterSize, peerSize } persisted across restarts
let alwaysOnTopTimer = null;

// Whether a foreign fullscreen app (e.g. a game) is currently active. While true,
// the character widgets are click-through so clicks/drags pass to the game.
let fullscreenActive = false;

// The two avatar windows share drag/click-through/always-on-top behavior.
const avatarWindows = () => [characterWindow, peerWindow].filter((w) => w && !w.isDestroyed());

// Fractional insets of the drag hitbox within the avatar window, sized to the
// visible sprite's opaque bounds (measured across all poses). This is the single
// source of truth — fractions, so it scales with the resizable window.
const HITBOX = { left: 0.23, right: 0.15, top: 0.37, bottom: 0.20 };
const HOVER_POLL_MS = 40;
let hoverTimer = null;

// Is the OS cursor currently over the window's drag hitbox? Computed in the main
// process from the authoritative cursor position rather than from renderer
// mousemove events, which can be swallowed/unreliable and once left the widget
// stuck click-through. Polling the cursor cannot desync — re-derived every tick.
const cursorOverHitbox = (win) => {
    if (!win || win.isDestroyed() || !win.isVisible()) return false;
    const b = win.getBounds();               // DIP
    const p = screen.getCursorScreenPoint(); // DIP
    const x1 = b.x + b.width * HITBOX.left;
    const x2 = b.x + b.width * (1 - HITBOX.right);
    const y1 = b.y + b.height * HITBOX.top;
    const y2 = b.y + b.height * (1 - HITBOX.bottom);
    return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
};

// A character window ignores the mouse (is click-through) when a fullscreen app is
// active OR the cursor is not over the avatar's drag hitbox. Only over the visible
// sprite is it interactive/draggable; the transparent padding passes clicks
// through. Only calls into Electron when the value actually changes.
const updateMouseIgnore = (win) => {
    if (!win || win.isDestroyed()) return;
    const ignore = fullscreenActive || !win._overHitbox;
    if (win._ignoring === ignore) return;
    win._ignoring = ignore;
    debug.log('setIgnoreMouseEvents', `win=${win === characterWindow ? 'character' : 'peer'}`,
        `ignore=${ignore}`, `(fullscreenActive=${fullscreenActive} overHitbox=${!!win._overHitbox})`);
    win.setIgnoreMouseEvents(ignore, { forward: true });
};

// Re-derive hover for both avatars from the cursor position and apply. Runs on a
// short interval so the widget can never remain stuck in the wrong mouse state.
const pollHover = () => {
    avatarWindows().forEach((win) => {
        win._overHitbox = cursorOverHitbox(win);
        updateMouseIgnore(win);
    });
};

// --- Manual drag + scroll-to-resize -----------------------------------------
// Dragging is implemented in the MAIN process (uiohook mousedown/mouseup + a
// cursor poll), not with `-webkit-app-region: drag`. The native CSS drag enters
// an OS modal move loop that (a) swallows wheel events for the duration of the
// hold, making scroll-resize-while-dragging impossible, and (b) would fight any
// programmatic setBounds. Manual dragging sidesteps both.
//
// While the left button is held on an avatar's hitbox:
//   - a 16ms tick moves the window so the grab point stays under the cursor,
//   - each wheel notch adjusts a TARGET size by RESIZE_STEP (clamped 60–400);
//     the tick eases the actual size toward the target so resizing feels
//     gradual instead of jumpy. Anchoring uses the grab point stored as a
//     FRACTION of the window, so it stays valid across resizes and the sprite
//     grows/shrinks around the cursor.
// The tick issues ONE validated setBounds per frame (position + size together).
const RESIZE_STEP = 8;        // px per wheel notch (applied to the target)
const RESIZE_EASE = 0.35;     // fraction of remaining distance applied per tick
const DRAG_POLL_MS = 16;
const LEFT_BUTTON = 1;        // uiohook button index (verified by probe)
let drag = null;              // { win, key, fx, fy, size, target, timer }

// The ONLY path to the native setBounds for avatar windows. Rejects any
// non-finite/degenerate value instead of passing it to Electron's native bridge,
// which throws an uncatchable-in-context "conversion failure" TypeError on
// NaN/Infinity (this crashed the app when a display-mode change mid-drag made
// getBounds return degenerate bounds and the grab-fraction math went non-finite).
// Also invalidates the click-through cache: setBounds can reset the window's
// native ex-styles, so the cached _ignoring value may no longer match reality —
// clearing it makes the next hover poll re-apply setIgnoreMouseEvents.
const setAvatarBounds = (win, x, y, size) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size)) {
        debug.log('setAvatarBounds REJECTED non-finite', x, y, size);
        return false;
    }
    const s = settings.clampSize(size); // finite integer in [MIN_SIZE, MAX_SIZE]
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: s, height: s });
    win._ignoring = undefined; // force re-apply of click-through on next poll
    return true;
};

const beginDrag = () => {
    if (drag || fullscreenActive) return;
    const win = avatarWindows().find(cursorOverHitbox);
    if (!win) return;
    const b = win.getBounds();
    // Degenerate bounds (e.g. mid display-mode change) would poison the grab
    // fractions with Infinity/NaN — refuse to start the drag instead.
    if (!(b.width > 0) || !(b.height > 0)) {
        debug.log('beginDrag REJECTED degenerate bounds', JSON.stringify(b));
        return;
    }
    const p = screen.getCursorScreenPoint();
    const size = settings.clampSize(prefs[win === characterWindow ? 'characterSize' : 'peerSize']);
    drag = {
        win,
        key: win === characterWindow ? 'characterSize' : 'peerSize',
        fx: (p.x - b.x) / b.width,
        fy: (p.y - b.y) / b.height,
        size,          // current logical size (float while easing)
        target: size,  // wheel notches move this; the tick eases toward it
        timer: setInterval(dragTick, DRAG_POLL_MS),
    };
    debug.log('drag start', drag.key, JSON.stringify(b));
};

// One frame of drag: ease the size toward the target and pin the grab point
// under the cursor, in a single validated setBounds.
const dragTick = () => {
    if (!drag || drag.win.isDestroyed()) return endDrag();
    const p = screen.getCursorScreenPoint();
    let s = drag.size;
    if (s !== drag.target) {
        s += (drag.target - s) * RESIZE_EASE;
        if (Math.abs(drag.target - s) < 0.5) s = drag.target; // settle exactly
        drag.size = s;
    }
    setAvatarBounds(drag.win, p.x - drag.fx * s, p.y - drag.fy * s, s);
};

const endDrag = () => {
    if (!drag) return;
    clearInterval(drag.timer);
    const d = drag;
    drag = null;
    if (d.win.isDestroyed()) return;
    // Land exactly on the target (the ease may not have settled yet).
    if (d.size !== d.target) {
        const p = screen.getCursorScreenPoint();
        setAvatarBounds(d.win, p.x - d.fx * d.target, p.y - d.fy * d.target, d.target);
    }
    debug.log('drag end', JSON.stringify(d.win.getBounds()));
};

// Wheel while held: move the resize target. uiohook reports scroll-up as
// rotation −1 (verified by probe), so growth = −rotation. Non-finite rotation
// (odd input devices) is ignored rather than propagated into the math.
const resizeHeldAvatar = (rotation) => {
    if (!drag || drag.win.isDestroyed()) return;
    if (!Number.isFinite(rotation) || rotation === 0) return;
    drag.target = settings.clampSize(drag.target + -Math.sign(rotation) * RESIZE_STEP);
    prefs[drag.key] = drag.target;
    settings.save(prefs);
    debug.log('resize target', drag.key, '->', drag.target);
};

// Always-on-top hardening. 'screen-saver' is a higher level than the default
// 'floating', which matters most on macOS (where 'floating' is easily covered).
const AOT_LEVEL = 'screen-saver';
// Lightweight re-assert (safe to call often, e.g. on an interval / blur): some
// OS/window managers silently drop always-on-top.
const reassertAlwaysOnTop = (win) => {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, AOT_LEVEL);
};
// Full enforce, used when a window first appears: also keeps it visible across
// macOS Spaces / other apps' fullscreen. setVisibleOnAllWorkspaces is macOS-only
// and not worth re-applying repeatedly, so it lives here rather than in the interval.
const enforceAlwaysOnTop = (win) => {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, AOT_LEVEL);
    if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
};

// Cache the latest code/status so a renderer that loads AFTER the network
// events fired can still ask for the current state (see 'link:request-state').
let lastCode = null;
let lastStatus = { status: 'connecting', detail: undefined };

// Loads web page into new BrowserWindow instance
const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 380,
        height: 395,
        frame: false,
        resizable: false,
        focusable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })

    mainWindow.loadFile('index.html')
}

const createCharacterWindow = () => {
    const size = screen.getPrimaryDisplay().workAreaSize;
    const w = prefs.characterSize; // persisted; anchor the right edge (60px margin)

    characterWindow = new BrowserWindow({
        width: w,
        height: w,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        focusable: true,
        x: size.width - 60 - w,
        y: 50,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    characterWindow.loadFile('character.html')
    // Start click-through; the hover poll flips it interactive when the cursor is
    // over the avatar hitbox.
    characterWindow._overHitbox = false;
    updateMouseIgnore(characterWindow);
    enforceAlwaysOnTop(characterWindow);
    characterWindow.on('blur', () => reassertAlwaysOnTop(characterWindow));
}

// The friend's avatar lives in its own always-on-top window, sitting just to the
// left of your own character. Created hidden; shown only while paired.
const createPeerWindow = () => {
    const size = screen.getPrimaryDisplay().workAreaSize;
    const w = prefs.peerSize; // persisted; sits left of the character with a 20px gap

    peerWindow = new BrowserWindow({
        width: w,
        height: w,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        focusable: true,
        show: false,
        x: size.width - 80 - prefs.characterSize - w,
        y: 50,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    peerWindow.loadFile('peer.html')
    peerWindow._overHitbox = false;
    updateMouseIgnore(peerWindow);
    enforceAlwaysOnTop(peerWindow);
    peerWindow.on('blur', () => reassertAlwaysOnTop(peerWindow));
}

// Creates window when ready
app.whenReady().then(() => {
    // Load (or first-time create) our persistent identity so our code survives
    // restarts. network.start sends it to the server on every connect.
    myIdentity = identity.load();
    // Persisted widget sizes (must load before the avatar windows are created).
    prefs = settings.load();
    debug.log('loaded sizes', JSON.stringify(prefs));

    createWindow()
    createCharacterWindow()
    createPeerWindow()

    // Periodically re-assert always-on-top: some OS/window managers silently drop
    // it (e.g. after another app grabs topmost). Cheap and idempotent.
    alwaysOnTopTimer = setInterval(() => avatarWindows().forEach(reassertAlwaysOnTop), 2000);

    // --- Local input: drive YOUR character (raw event is fine locally) AND
    //     relay an ABSTRACT signal to the paired peer (never the raw event). ---
    uIOhook.on('keydown', event => {
        characterWindow.webContents.send('global-keydown', event);
        network.sendInput('key-down');
    })
    uIOhook.on('keyup', event => {
        characterWindow.webContents.send('global-keyup', event);
        network.sendInput('key-up');
    });
    uIOhook.on('mousedown', event => {
        characterWindow.webContents.send('global-mousedown', event);
        // event.button is an integer button index — abstract, no coordinates.
        network.sendInput('mouse-down', event.button);
        // Left-click on an avatar's hitbox starts a manual drag of that widget.
        if (event.button === LEFT_BUTTON) beginDrag();
    });
    uIOhook.on('mouseup', event => {
        characterWindow.webContents.send('global-mouseup', event);
        network.sendInput('mouse-up', event.button);
        if (event.button === LEFT_BUTTON) endDrag();
    });
    // Scroll while holding an avatar resizes it. Wheel events are NOT relayed to
    // the peer — the network protocol stays key/mouse up/down only.
    uIOhook.on('wheel', event => {
        if (drag) resizeHeldAvatar(event.rotation);
    });
    uIOhook.start();

    // --- Networking: connect to TinyLinkServer and wire callbacks. ---
    network.start({
        identity: myIdentity,
        onCode: (code) => {
            // Persist the server-confirmed code (usually ours; a new one only on a
            // rare cross-machine collision) so it stays stable next launch.
            identity.setCode(myIdentity, code);
            lastCode = code;
            if (mainWindow) mainWindow.webContents.send('link:code', code);
        },
        onStatus: (status, detail) => {
            lastStatus = { status, detail };
            if (mainWindow) mainWindow.webContents.send('link:status', status, detail);

            // Peer avatar visibility follows the pairing lifecycle.
            if (status === 'paired') {
                if (peerWindow) {
                    peerWindow.show();
                    // The peer window may appear mid-game / behind others; inherit
                    // current mouse state and re-assert always-on-top.
                    updateMouseIgnore(peerWindow);
                    enforceAlwaysOnTop(peerWindow);
                }
            } else if (status === 'peer-left' || status === 'offline') {
                if (peerWindow) {
                    peerWindow.webContents.send('peer-reset');
                    peerWindow.hide();
                }
            }
        },
        onPeerInput: (event, button) => {
            if (!peerWindow) return;
            const channel = {
                'key-down': 'peer-keydown',
                'key-up': 'peer-keyup',
                'mouse-down': 'peer-mousedown',
                'mouse-up': 'peer-mouseup',
            }[event];
            if (channel) peerWindow.webContents.send(channel, button);
        },
    });

    // --- Renderer -> main IPC ---
    ipcMain.on('link:pair', (_event, code) => {
        network.pairWith(code);
    });

    // A renderer that just loaded asks for the current code/status.
    ipcMain.on('link:request-state', (event) => {
        if (lastCode) event.sender.send('link:code', lastCode);
        event.sender.send('link:status', lastStatus.status, lastStatus.detail);
    });

    // Only the visible sprite is grabbable: poll the cursor and toggle
    // click-through so the transparent padding passes clicks through.
    hoverTimer = setInterval(pollHover, HOVER_POLL_MS);

    // --- Fullscreen click-through: when a foreign fullscreen app (e.g. a game)
    //     is active, make the character widgets click-through so clicks/drags
    //     pass to the game; restore interactivity when it exits. This only
    //     toggles mouse handling on the widgets — uiohook capture is untouched. ---
    fullscreen.start((isFullscreen) => {
        debug.log('fullscreen transition ->', isFullscreen);
        fullscreenActive = isFullscreen;
        if (isFullscreen) endDrag(); // never keep dragging/resizing under a game
        avatarWindows().forEach(updateMouseIgnore);
    });
});

// Close app when all windows closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        uIOhook.stop();
        fullscreen.stop();
        endDrag();
        if (alwaysOnTopTimer) clearInterval(alwaysOnTopTimer);
        if (hoverTimer) clearInterval(hoverTimer);
        app.quit();
    }
})
