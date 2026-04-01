/**
 * engine.js — Styx core game engine
 * Canvas setup, 60fps game loop, CGA palette constants
 */

// CGA palette constants — all colour references must use these
const CGA = {
  BLACK:   '#000000',
  CYAN:    '#00FFFF',
  MAGENTA: '#FF00FF',
  WHITE:   '#FFFFFF',
};

// ---------------------------------------------------------------------------
// Canvas initialisation
// ---------------------------------------------------------------------------
const canvas = document.getElementById('styx-canvas');
const ctx    = canvas.getContext('2d');

const CANVAS_W = canvas.width;   // 800
const CANVAS_H = canvas.height;  // 580

// Playfield border inset (pixels from canvas edge)
const BORDER_INSET = 8;

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function render() {
  // Clear with black background
  ctx.fillStyle = CGA.BLACK;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // White playfield border rectangle
  ctx.strokeStyle = CGA.WHITE;
  ctx.lineWidth   = 2;
  ctx.strokeRect(
    BORDER_INSET,
    BORDER_INSET,
    CANVAS_W - BORDER_INSET * 2,
    CANVAS_H - BORDER_INSET * 2
  );
}

function gameLoop() {
  render();
  requestAnimationFrame(gameLoop);
}

// Kick off the loop once the page is ready
window.addEventListener('load', function () {
  requestAnimationFrame(gameLoop);
});
