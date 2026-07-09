// settings.js — persists user preferences (currently the avatar widget sizes) as
// JSON in Electron's userData directory, same pattern as identity.js. Sizes are
// clamped on load so a hand-edited file can't create an unusable widget.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MIN_SIZE = 60;
const MAX_SIZE = 400;
const DEFAULT_SIZE = 140;

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

function load() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) || {};
  } catch (_e) {
    // missing or corrupt — fall through to defaults
  }
  return {
    characterSize: clampSize(raw.characterSize !== undefined ? raw.characterSize : DEFAULT_SIZE),
    peerSize: clampSize(raw.peerSize !== undefined ? raw.peerSize : DEFAULT_SIZE),
  };
}

// Debounced: scroll-resizing fires many notches in a burst; write once it settles.
let saveTimer = null;
function save(settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2));
    } catch (e) {
      console.log('[settings] could not save:', e.message);
    }
  }, 400);
}

module.exports = { load, save, clampSize, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE };
