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

const POLL_MS = 1000;
const EDGE_TOL = 2;   // px slack for "origin at the monitor corner"
const COVER_TOL = 2;  // px slack for "reaches the far/bottom edge"

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

function isForeignFullscreen(win) {
  if (!win || !win.bounds) return false;
  // Ignore our own windows so we never make ourselves click-through.
  const owner = (win.owner && win.owner.name) || '';
  if (owner === 'Electron' || owner === 'TinyLink') return false;
  const display = screen.getDisplayMatching(win.bounds);
  return coversDisplay(win.bounds, display.bounds);
}

// start(onChange): begins polling. onChange(isFullscreen) is called only on
// transitions (false->true, true->false), starting from an assumed non-fullscreen
// state.
function start(onChange) {
  stop();
  const tick = async () => {
    if (polling) return;
    polling = true;
    let fs = false;
    try {
      fs = isForeignFullscreen(await getActiveWindow());
    } catch (_e) {
      // If window querying fails (e.g. macOS Screen Recording permission not
      // granted), degrade gracefully: treat as not-fullscreen so the widgets
      // simply stay interactive.
      fs = false;
    }
    polling = false;
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

module.exports = { start, stop, coversDisplay };
