// peer.js — renders the PAIRED FRIEND's avatar, driven by abstract signals
// relayed from their machine via TinyLinkServer. Mirrors character.js, but reads
// window.peer (the friend's input) instead of window.input (your own).
//
// It only ever learns "key/mouse down/up" — never which key or where. The mouse
// `button` index is available but currently unused by the animation.

let keyDown = false;
let mouseDown = false;

window.peer.onKeyDown(() => {
  keyDown = true;
  updateCharacterImage();
});

window.peer.onKeyUp(() => {
  keyDown = false;
  updateCharacterImage();
});

window.peer.onMouseDown(() => {
  mouseDown = true;
  updateCharacterImage();
});

window.peer.onMouseUp(() => {
  mouseDown = false;
  updateCharacterImage();
});

// Fired when the peer disconnects — return the avatar to its idle pose.
window.peer.onReset(() => {
  keyDown = false;
  mouseDown = false;
  updateCharacterImage();
});

function updateCharacterImage() {
  if (keyDown && mouseDown) {
    document.body.style.backgroundImage = 'url("assets/characterDown.png")';
  }
  else if (keyDown) {
    document.body.style.backgroundImage = 'url("assets/characterRightDown.png")';
  }
  else if (mouseDown) {
    document.body.style.backgroundImage = 'url("assets/characterLeftDown.png")';
  }
  else {
    document.body.style.backgroundImage = 'url("assets/characterUp.png")';
  }
}

// Report cursor-over-hitbox so main makes only the visible sprite draggable; the
// transparent padding stays click-through. (Same logic as character.js.)
setupHitbox();
function setupHitbox() {
  const hitbox = document.getElementById('hitbox');
  let over = false;
  const report = (x, y) => {
    const r = hitbox.getBoundingClientRect();
    const now = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (now !== over) {
      over = now;
      window.widget.setHover(now);
    }
  };
  window.addEventListener('mousemove', (e) => report(e.clientX, e.clientY));
  window.addEventListener('mouseleave', () => {
    if (over) { over = false; window.widget.setHover(false); }
  });
}
