// network.js — TinyLink's networking layer (runs in the Electron MAIN process).
//
// Wraps a socket.io-client connection to TinyLinkServer. Responsibilities:
//   - register (server assigns our short code on connect) and expose it,
//   - pair with a friend's code,
//   - send our LOCAL input to the server as ABSTRACT signals only,
//   - deliver the peer's abstract signals back to main.js.
//
// PRIVACY CONSTRAINT (do not weaken): sendInput() is the only outbound path for
// input, and it accepts only a fixed event name plus an optional integer mouse
// button. It never reads or forwards key codes, typed characters, or cursor
// coordinates. main.js maps raw uiohook events into these abstract signals; the
// raw event object must never be passed here. See CLAUDE.md.

const { io } = require('socket.io-client');

// Connect to the deployed TinyLinkServer by default so `npm start` works out of
// the box. Override with the TINYLINK_SERVER_URL env var to point elsewhere
// (e.g. TINYLINK_SERVER_URL=http://localhost:8080 for local testing).
// socket.io-client derives its transport scheme from this URL: an https:// URL
// means the WebSocket upgrade uses wss:// (secure) automatically.
const SERVER_URL = process.env.TINYLINK_SERVER_URL || 'https://tinylinkserver-d1vl.onrender.com';

// The only input signals we are allowed to emit. Anything else is dropped here
// as a second line of defence behind the server's own allow-list.
const ALLOWED_EVENTS = new Set(['key-down', 'key-up', 'mouse-down', 'mouse-up']);

let socket = null;
let myCode = null;
// Persisted { clientId, code } supplied by main.js; sent on every (re)connect so
// the server can give us a stable code across restarts.
let identity = null;

// Callbacks supplied by main.js. Defaults are no-ops so calling before start()
// is harmless.
const handlers = {
  onCode: () => {},
  onStatus: () => {},
  onPeerInput: () => {},
};

// status values: 'connecting' | 'online' | 'offline' | 'paired' | 'peer-left'
//                | 'error:<reason>'
function setStatus(status, detail) {
  handlers.onStatus(status, detail);
}

function start({ identity: id, onCode, onStatus, onPeerInput } = {}) {
  if (id) identity = id;
  if (onCode) handlers.onCode = onCode;
  if (onStatus) handlers.onStatus = onStatus;
  if (onPeerInput) handlers.onPeerInput = onPeerInput;

  setStatus('connecting');

  // socket.io-client handles reconnection/backoff for us (why socket.io was
  // chosen). transports left at default (polling upgrade -> websocket).
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  console.log(`[network] connecting to ${SERVER_URL} …`);

  socket.on('connect', () => {
    console.log(`[network] connected (${socket.id})`);
    setStatus('online');
    // Register (or re-register) our persisted code on every connect/reconnect so
    // the code stays stable across restarts and network blips.
    socket.emit('register', {
      clientId: identity && identity.clientId,
      code: identity && identity.code,
    });
  });
  socket.on('disconnect', (reason) => {
    console.log(`[network] disconnected: ${reason}`);
    setStatus('offline');
  });
  socket.on('connect_error', (err) => {
    console.log(`[network] connect_error: ${err.message} (will retry)`);
    setStatus('offline');
  });

  socket.on('registered', ({ code }) => {
    console.log(`[network] registered — your code is ${code}`);
    myCode = code;
    handlers.onCode(code);
  });

  socket.on('paired', ({ peerCode }) => setStatus('paired', peerCode));
  socket.on('pair-error', ({ reason }) => setStatus('error', reason));
  socket.on('peer-disconnected', () => setStatus('peer-left'));

  socket.on('peer-input', (payload) => {
    const event = payload && payload.event;
    if (!ALLOWED_EVENTS.has(event)) return;
    const button = typeof payload.button === 'number' ? payload.button : undefined;
    handlers.onPeerInput(event, button);
  });
}

function pairWith(code) {
  if (!socket) return;
  socket.emit('pair', { code: String(code || '') });
}

// Emit a single ABSTRACT input signal. `event` must be one of ALLOWED_EVENTS;
// `button` (optional) is an integer mouse-button index only. Never pass a raw
// uiohook event here.
function sendInput(event, button) {
  if (!socket || !socket.connected) return;
  if (!ALLOWED_EVENTS.has(event)) return;
  const msg = { event };
  if (typeof button === 'number') msg.button = button;
  socket.emit('input', msg);
}

function getCode() {
  return myCode;
}

module.exports = { start, pairWith, sendInput, getCode, SERVER_URL };
