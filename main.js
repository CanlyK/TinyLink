// Imports app and BrowserWindow Electron modules
const { app, BrowserWindow, screen} = require('electron')
const { uIOhook } = require('uiohook-napi');
const path = require('path');

let mainWindow;
let characterWindow;

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
// Creates window when ready
app.whenReady().then(() => {
    createWindow()
    createCharacterWindow()

    uIOhook.on('keydown', event => {
        characterWindow.webContents.send('global-keydown', event);
    })
    uIOhook.on('keyup', event => {
        characterWindow.webContents.send('global-keyup', event);
    });
    uIOhook.on('mousedown', event => {
        characterWindow.webContents.send('global-mousedown', event);
    });
    uIOhook.on('mouseup', event => {
        characterWindow.webContents.send('global-mouseup', event);
    });
    uIOhook.start();

});

// Close app when all windows closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        uIOhook.stop();
        app.quit();
    } 
})