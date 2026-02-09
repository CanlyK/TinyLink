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
