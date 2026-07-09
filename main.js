// Imports app and BrowserWindow Electron modules
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const { uIOhook } = require('uiohook-napi');
const path = require('path');
const network = require('./network');
const fullscreen = require('./fullscreen');
const identity = require('./identity');

let mainWindow;
let characterWindow;
let peerWindow;
let myIdentity;             // { clientId, code } persisted across restarts
let alwaysOnTopTimer = null;

// Whether a foreign fullscreen app (e.g. a game) is currently active. While true,
// the character widgets are click-through so clicks/drags pass to the game.
let fullscreenActive = false;

// The two avatar windows share drag/click-through/always-on-top behavior.
const avatarWindows = () => [characterWindow, peerWindow].filter((w) => w && !w.isDestroyed());

// A character window should ignore the mouse (be click-through) when a fullscreen
// app is active OR the cursor is NOT over the avatar's drag hitbox. Only over the
// visible sprite is it interactive/draggable; the transparent padding passes
// clicks through. `win._overHitbox` is updated from the renderer ('widget:hover').
const updateMouseIgnore = (win) => {
    if (!win || win.isDestroyed()) return;
    const ignore = fullscreenActive || !win._overHitbox;
    win.setIgnoreMouseEvents(ignore, { forward: true });
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
        height: 355,
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

    characterWindow = new BrowserWindow({
        width: 140,
        height: 140,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        focusable: true,
        x: size.width - 200,
        y: 50,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    characterWindow.loadFile('character.html')
    characterWindow._overHitbox = false;
    // Start click-through; the renderer flips it interactive when the cursor is
    // over the avatar hitbox.
    characterWindow.setIgnoreMouseEvents(true, { forward: true });
    enforceAlwaysOnTop(characterWindow);
    characterWindow.on('blur', () => reassertAlwaysOnTop(characterWindow));
}

// The friend's avatar lives in its own always-on-top window, sitting just to the
// left of your own character. Created hidden; shown only while paired.
const createPeerWindow = () => {
    const size = screen.getPrimaryDisplay().workAreaSize;

    peerWindow = new BrowserWindow({
        width: 140,
        height: 140,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        focusable: true,
        show: false,
        x: size.width - 360,
        y: 50,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    peerWindow.loadFile('peer.html')
    peerWindow._overHitbox = false;
    peerWindow.setIgnoreMouseEvents(true, { forward: true });
    enforceAlwaysOnTop(peerWindow);
    peerWindow.on('blur', () => reassertAlwaysOnTop(peerWindow));
}

// Creates window when ready
app.whenReady().then(() => {
    // Load (or first-time create) our persistent identity so our code survives
    // restarts. network.start sends it to the server on every connect.
    myIdentity = identity.load();

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
    });
    uIOhook.on('mouseup', event => {
        characterWindow.webContents.send('global-mouseup', event);
        network.sendInput('mouse-up', event.button);
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

    // An avatar renderer reports whether the cursor is over its drag hitbox, so we
    // can make just the visible sprite interactive and pass clicks through the
    // transparent padding around it.
    ipcMain.on('widget:hover', (event, over) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        win._overHitbox = !!over;
        updateMouseIgnore(win);
    });

    // --- Fullscreen click-through: when a foreign fullscreen app (e.g. a game)
    //     is active, make the character widgets click-through so clicks/drags
    //     pass to the game; restore interactivity when it exits. This only
    //     toggles mouse handling on the widgets — uiohook capture is untouched. ---
    fullscreen.start((isFullscreen) => {
        fullscreenActive = isFullscreen;
        avatarWindows().forEach(updateMouseIgnore);
    });
});

// Close app when all windows closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        uIOhook.stop();
        fullscreen.stop();
        if (alwaysOnTopTimer) clearInterval(alwaysOnTopTimer);
        app.quit();
    }
})
