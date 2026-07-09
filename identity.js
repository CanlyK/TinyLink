// identity.js — persists this machine's stable pairing identity across restarts
// (main process). Stored as JSON in Electron's userData directory so a friend who
// saved your code once never needs a new one.
//
// We persist two things:
//   - clientId: a stable random UUID identifying this install. Lets the server
//     recognise "the same client reconnecting" and hand back the same code even
//     if an old socket is briefly still registered (see server.js register).
//   - code: the 6-char pairing code. Generated locally on first run; the server
//     confirms it (or, on a rare cross-machine collision, assigns a new one which
//     we then persist via setCode).

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Same unambiguous alphabet as the server (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

function filePath() {
  return path.join(app.getPath('userData'), 'identity.json');
}

function save(identity) {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(identity, null, 2));
  } catch (e) {
    console.log('[identity] could not save:', e.message);
  }
}

// Load the persisted identity, creating and saving one on first run.
function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (parsed && parsed.clientId && parsed.code) return parsed;
  } catch (_e) {
    // missing or corrupt — fall through and create a fresh identity
  }
  const identity = { clientId: crypto.randomUUID(), code: randomCode() };
  save(identity);
  return identity;
}

// Persist a (possibly server-corrected) code onto an in-memory identity object.
function setCode(identity, code) {
  if (code && code !== identity.code) {
    identity.code = code;
    save(identity);
  }
  return identity;
}

module.exports = { load, save, setCode, randomCode };
