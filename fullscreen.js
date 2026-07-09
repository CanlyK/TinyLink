// fullscreen.js — detects whether ANOTHER application is currently running
// fullscreen (e.g. a game like League of Legends or Roblox), so main.js can make
// the character widgets click-through while it is.
//
// WHY POLLING: neither the OS nor Electron fires a cross-platform event when a
// *foreign* app enters/leaves fullscreen (Electron's 'enter-full-screen' only
// fires for our own BrowserWindows). So we poll the active window on a timer.
//
// HOW WE DECIDE "fullscreen": we look at the active (foreground) window's bounds
// and compare them to the bounds of the monitor it is on:
//   - it must COVER the whole monitor (reaching the far/bottom edges), and
//   - its ORIGIN must sit at the monitor's top-left corner.
// The origin test is what separates a *fullscreen* window from a merely
// *maximized* one: Windows inflates a maximized window slightly beyond the
// monitor (origin at e.g. -7,-7 to hide borders), whereas a true fullscreen /
// borderless-windowed app sits exactly at 0,0. This also catches borderless
// fullscreen (what most modern games use), which an "exclusive-fullscreen-only"
// check (e.g. SHQueryUserNotificationState on Windows) would miss.
//
// This does NOT touch uiohook global input capture — that is a separate system
// and keeps running regardless of focus.

const { screen } = require('electron');
const debug = require('./debuglog');

const POLL_MS = 1000;
const EDGE_TOL = 2;   // px slack for "origin at the monitor corner"
const COVER_TOL = 2;  // px slack for "reaches the far/bottom edge"
const ACTIVE_WINDOW_TIMEOUT_MS = 2000;

// The desktop shell is NOT a fullscreen app, but it is a window sitting exactly
// at the monitor origin covering the whole screen — so it passes the geometry
// test and must be excluded by owner/title. Missing this caused the widget to get
// permanently stuck click-through: once click-through, clicks fell through to the
// desktop, which kept it the foreground window, which kept the detector firing.
const SHELL_OWNERS = new Set([
  'Windows Explorer', 'explorer.exe',           // Windows desktop (Progman/WorkerW) + taskbar
  'Finder', 'Dock', 'Window Server', 'SystemUIServer', // macOS shell
]);

let timer = null;
let lastState = false;
let polling = false;      // guards against overlapping async polls
let activeWindowFn = null;

// get-windows is ESM-only; load it lazily via dynamic import from our CommonJS.
async function getActiveWindow() {
  if (!activeWindowFn) {
    const mod = await import('get-windows');
    activeWindowFn = mod.activeWindow;
  }
  return activeWindowFn();
}

// Never let a hung window query wedge the poll loop forever.
async function withTimeout(query) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('activeWindow() timed out')), ACTIVE_WINDOW_TIMEOUT_MS);
  });
  try {
    return await Promise.race([query(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// The desktop / taskbar / Finder are never "a fullscreen app".
function isShellWindow(owner, title) {
  if (SHELL_OWNERS.has(owner)) return true;
  return (title || '').trim() === 'Program Manager';
}

// Pure geometry test (no Electron) so it can be unit-tested. Returns true if a
// window with bounds `b` fully covers a display with bounds `db`, anchored at the
// display's origin (i.e. fullscreen, not maximized).
function coversDisplay(b, db) {
  if (!b || !db) return false;
  const atOrigin =
    Math.abs(b.x - db.x) <= EDGE_TOL &&
    Math.abs(b.y - db.y) <= EDGE_TOL;
  const reachesFarEdges =
    (b.x + b.width) >= (db.x + db.width) - COVER_TOL &&
    (b.y + b.height) >= (db.y + db.height) - COVER_TOL;
  return atOrigin && reachesFarEdges;
}

// On Windows, get-windows reports PHYSICAL pixels (GetWindowRect) while Electron's
// display.bounds is in DIP. On a scaled display (e.g. 150%) comparing them
// directly makes "covers the monitor" trivially true for ordinary windows, so
// convert first. screenToDipRect is Windows-only; macOS already reports points.
function toDipRect(rect) {
  if (process.platform !== 'win32') return rect;
  try {
    return screen.screenToDipRect(null, rect);
  } catch (_e) {
    return rect;
  }
}

function isForeignFullscreen(win) {
  if (!win || !win.bounds) return false;
  const owner = (win.owner && win.owner.name) || '';
  const title = win.title || '';

  // Ignore our own windows so we never make ourselves click-through.
  const isSelf = owner === 'Electron' || owner === 'TinyLink';
  const isShell = isShellWindow(owner, title);
  // Minimized windows report bogus coordinates (e.g. x=-32000).
  const sane = win.bounds.width > 0 && win.bounds.height > 0;

  let result = false;
  let dip = null;
  let displayBounds = null;
  if (!isSelf && !isShell && sane) {
    dip = toDipRect(win.bounds);
    const display = screen.getDisplayMatching(dip);
    displayBounds = display.bounds;
    result = coversDisplay(dip, displayBounds);
  }

  if (debug.enabled) {
    debug.log(
      'tick', `owner="${owner}"`, `title="${title.slice(0, 40)}"`,
      'raw=' + JSON.stringify(win.bounds),
      'dip=' + JSON.stringify(dip),
      'disp=' + JSON.stringify(displayBounds),
      `self=${isSelf}`, `shell=${isShell}`,
      '=> fs=' + result
    );
  }
  return result;
}

// start(onChange, opts): begins polling. onChange(isFullscreen) is called only on
// transitions (false->true, true->false), starting from an assumed non-fullscreen
// state. `opts.provider` is a test seam that replaces the active-window query.
function start(onChange, opts = {}) {
  stop();
  const provider = opts.provider || getActiveWindow;
  const tick = async () => {
    if (polling) return;
    polling = true;
    let fs = false;
    try {
      fs = isForeignFullscreen(await withTimeout(provider));
    } catch (e) {
      // If window querying fails or hangs (e.g. macOS Screen Recording permission
      // not granted), degrade gracefully: treat as NOT fullscreen so the widgets
      // stay interactive. Failing open matters — failing closed would leave the
      // widget permanently click-through.
      fs = false;
      debug.log('detector error (failing open):', e && e.message);
    } finally {
      // Must always clear, or a single rejection/hang would wedge the poll loop
      // forever and freeze fullscreenActive at its last value.
      polling = false;
    }
    if (fs !== lastState) {
      lastState = fs;
      try { onChange(fs); } catch (_e) { /* ignore consumer errors */ }
    }
  };
  tick();
  timer = setInterval(tick, POLL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  lastState = false;
}

module.exports = { start, stop, coversDisplay, isShellWindow, isForeignFullscreen };
