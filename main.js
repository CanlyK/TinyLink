// Imports app and BrowserWindow Electron modules
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const { uIOhook } = require('uiohook-napi');
const path = require('path');
const network = require('./network');

let mainWindow;
let characterWindow;
let peerWindow;

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
}

// Creates window when ready
app.whenReady().then(() => {
    createWindow()
    createCharacterWindow()
    createPeerWindow()

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
        onCode: (code) => {
            lastCode = code;
            if (mainWindow) mainWindow.webContents.send('link:code', code);
        },
        onStatus: (status, detail) => {
            lastStatus = { status, detail };
            if (mainWindow) mainWindow.webContents.send('link:status', status, detail);

            // Peer avatar visibility follows the pairing lifecycle.
            if (status === 'paired') {
                if (peerWindow) peerWindow.show();
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
});

// Close app when all windows closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        uIOhook.stop();
        app.quit();
    }
})
