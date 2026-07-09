// connect.js — control-panel renderer. Shows your pairing code, sends the
// friend's code to pair, and reflects connection/pairing status. Talks to the
// main process only through window.link (see preload.js).

const yourCodeInput = document.getElementById('your-code');
const friendCodeInput = document.getElementById('friend-code');
const connectButton = document.getElementById('connect-button');
const statusEl = document.getElementById('status');

// Your code, assigned by the server on connect.
window.link.onCode((code) => {
  yourCodeInput.value = code;
});

// Human-readable status messages for each state the network layer reports.
const ERROR_TEXT = {
  'invalid-code': "That code isn't valid. Double-check with your friend.",
  'self-pair': "That's your own code! Enter your friend's.",
  'peer-busy': 'That person is already paired with someone.',
};

window.link.onStatus((status, detail) => {
  switch (status) {
    case 'connecting':
      setStatus('Connecting to server…');
      break;
    case 'online':
      setStatus('Share your code or enter a friend\'s.');
      break;
    case 'offline':
      setStatus('Server unreachable - retrying…');
      break;
    case 'paired':
      setStatus(`Paired with ${detail}`);
      break;
    case 'peer-left':
      setStatus('Your friend disconnected.');
      break;
    case 'error':
      setStatus(ERROR_TEXT[detail] || `Couldn't pair (${detail}).`);
      break;
    default:
      setStatus('');
  }
});

connectButton.addEventListener('click', () => {
  const code = friendCodeInput.value.trim().toUpperCase();
  if (!code) {
    setStatus('Enter your friend\'s code first.');
    return;
  }
  setStatus('Pairing…');
  window.link.pair(code);
});

// Enter key in the friend-code field triggers connect.
friendCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectButton.click();
});

function setStatus(text) {
  statusEl.textContent = text;
}

// Ask main for the current code/status in case they were set before this
// window finished loading.
window.link.requestState();
