let keyDown = false;
let mouseDown = false;

window.input.onKeyDown(() => {
  keyDown = true;
  updateCharacterImage();
});

window.input.onKeyUp(() => {
  keyDown = false;
  updateCharacterImage();
});

window.input.onMouseDown(() => {
  mouseDown = true;
  updateCharacterImage();
});

window.input.onMouseUp(() => {
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

// Report to the main process whether the cursor is over the drag hitbox (the
// visible sprite). Main makes the window interactive/draggable only then; the
// transparent padding stays click-through. mousemove events keep flowing while
// click-through because the window is set with { forward: true }.
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
  // Safety net: if the cursor leaves the window entirely, revert to click-through.
  window.addEventListener('mouseleave', () => {
    if (over) { over = false; window.widget.setHover(false); }
  });
}
