/**
 * engine.js — Styx core game engine
 * Canvas setup, 60fps game loop, CGA palette constants,
 * player marker & 8-directional movement (issue #3).
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

// Grid cell size — player positions are always multiples of CELL
const CELL = 8;

// Playfield grid boundaries (pixel coords)
const FIELD_LEFT   = BORDER_INSET;
const FIELD_TOP    = BORDER_INSET;
const FIELD_RIGHT  = CANVAS_W - BORDER_INSET;
const FIELD_BOTTOM = CANVAS_H - BORDER_INSET;

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

/**
 * Player state.
 * x, y are pixel positions snapped to the CELL grid.
 * Player starts at the top-left corner of the playfield border.
 */
const player = {
  x: FIELD_LEFT,
  y: FIELD_TOP,
};

/** Keys currently held (by e.code) */
const keysHeld = new Set();

// ---------------------------------------------------------------------------
// Helper: snap a pixel value to the nearest CELL grid position
// ---------------------------------------------------------------------------
function snapToGrid(v) {
  return Math.round(v / CELL) * CELL;
}

// ---------------------------------------------------------------------------
// Helper: clamp position to playfield grid boundaries
// ---------------------------------------------------------------------------
function clampToField(px, py) {
  return {
    x: Math.max(FIELD_LEFT, Math.min(FIELD_RIGHT - CELL, snapToGrid(px))),
    y: Math.max(FIELD_TOP,  Math.min(FIELD_BOTTOM - CELL, snapToGrid(py))),
  };
}

// ---------------------------------------------------------------------------
// Helper: is (px, py) on the outer border perimeter?
// Returns true when the position lies on the rectangular border edge.
// ---------------------------------------------------------------------------
function isOnOuterBorder(px, py) {
  const x = snapToGrid(px);
  const y = snapToGrid(py);
  const inHorizRange = x >= FIELD_LEFT && x <= FIELD_RIGHT - CELL;
  const inVertRange  = y >= FIELD_TOP  && y <= FIELD_BOTTOM - CELL;
  const onLeft   = x === FIELD_LEFT;
  const onRight  = x === FIELD_RIGHT - CELL;
  const onTop    = y === FIELD_TOP;
  const onBottom = y === FIELD_BOTTOM - CELL;
  return (onTop || onBottom) && inHorizRange ||
         (onLeft || onRight) && inVertRange;
}

// ---------------------------------------------------------------------------
// Helper: is (px, py) on a valid position for normal (non-draw) movement?
// In issue #3 this is only the outer border; claimed-edge support is added in #5.
// ---------------------------------------------------------------------------
function isOnSafeEdge(px, py) {
  return isOnOuterBorder(px, py);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------
window.addEventListener('keydown', function (e) {
  keysHeld.add(e.code);

  // Prevent page scroll from arrow keys and space
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
    e.preventDefault();
  }

  // Movement — only process arrow keys
  const isArrow = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code);
  if (!isArrow) return;

  // Build delta from all currently held arrow keys (supports diagonals)
  let dx = 0;
  let dy = 0;
  if (keysHeld.has('ArrowLeft'))  dx -= CELL;
  if (keysHeld.has('ArrowRight')) dx += CELL;
  if (keysHeld.has('ArrowUp'))    dy -= CELL;
  if (keysHeld.has('ArrowDown'))  dy += CELL;

  const newPos = clampToField(player.x + dx, player.y + dy);

  // Normal mode: only allow movement along valid edges
  if (isOnSafeEdge(newPos.x, newPos.y)) {
    player.x = newPos.x;
    player.y = newPos.y;
  }
});

window.addEventListener('keyup', function (e) {
  keysHeld.delete(e.code);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Draw the player marker — magenta 8×8 square.
 */
function renderPlayer() {
  ctx.fillStyle = CGA.MAGENTA;
  ctx.fillRect(player.x, player.y, CELL, CELL);
}

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

  // Player
  renderPlayer();
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function gameLoop() {
  render();
  requestAnimationFrame(gameLoop);
}

// Kick off the loop once the page is ready
window.addEventListener('load', function () {
  requestAnimationFrame(gameLoop);
});
