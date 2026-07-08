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
