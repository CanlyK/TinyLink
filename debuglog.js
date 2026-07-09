// debuglog.js — opt-in file logger for main-process diagnostics.
//
// Electron's main-process console.log does not reliably reach stdout on Windows
// (GUI subsystem), so debugging goes to a file instead. Enabled only when
// TINYLINK_DEBUG_LOG is set to a writable path; otherwise every call is a no-op.
//
//   $env:TINYLINK_DEBUG_LOG="C:\temp\tinylink.log"; npm start

const fs = require('fs');

const target = process.env.TINYLINK_DEBUG_LOG || null;

function log(...parts) {
  if (!target) return;
  try {
    fs.appendFileSync(target, `[${new Date().toISOString()}] ${parts.join(' ')}\n`);
  } catch (_e) {
    // never let logging break the app
  }
}

module.exports = { log, enabled: !!target };
