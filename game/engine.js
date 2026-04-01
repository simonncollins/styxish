/**
 * engine.js — Styx core game engine
 * Canvas setup, 60fps game loop, CGA palette constants,
 * player movement (issue #3), draw mode & Stix line rendering (issue #4).
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

/**
 * Current in-progress Stix draw line.
 * Array of {x, y} pixel positions tracing the path the player has drawn.
 * Populated while SPACEBAR is held and player moves.
 * Cleared when line completes (connects back to border) or SPACEBAR released.
 */
let currentLine = [];

/** True when SPACEBAR is held and player is in draw mode. */
let drawMode = false;

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
// Extended in issue #5 to include claimed territory edges.
// ---------------------------------------------------------------------------
function isOnSafeEdge(px, py) {
  return isOnOuterBorder(px, py);
}

// ---------------------------------------------------------------------------
// Stub: flood-fill claim — implemented in issue #5.
// Called when the draw line connects back to a safe edge.
//
// @param {Array<{x:number, y:number}>} borderLine - Completed Stix line cells
// @param {{x:number, y:number}|null} enemyPosition - See issue #5 for details
// ---------------------------------------------------------------------------
function floodFillClaim(borderLine, enemyPosition = null) { // eslint-disable-line no-unused-vars
  // TODO: implement in issue #5 (flood-fill territory claiming)
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

  // SPACEBAR toggles draw mode on
  if (e.code === 'Space') {
    if (!drawMode) {
      drawMode = true;
    }
    return;
  }

  // Only process arrow keys for movement
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

  if (drawMode) {
    // Draw mode: player can move into unclaimed interior space

    // Cannot retrace or cross own current draw line
    const onCurrentLine = currentLine.some(p => p.x === newPos.x && p.y === newPos.y);
    if (onCurrentLine) return;

    // Check if moving back onto a safe edge while we have a line in progress
    if (currentLine.length > 0 && isOnSafeEdge(newPos.x, newPos.y)) {
      // Line complete — add terminal point, trigger flood-fill, reset draw state
      currentLine.push({ x: newPos.x, y: newPos.y });
      player.x = newPos.x;
      player.y = newPos.y;
      const completedLine = currentLine.slice();
      currentLine = [];
      drawMode = false;
      floodFillClaim(completedLine, null);
    } else {
      // Extend the line: record current player position before moving
      currentLine.push({ x: player.x, y: player.y });
      player.x = newPos.x;
      player.y = newPos.y;
    }
  } else {
    // Normal mode: only allow movement along safe edges
    if (isOnSafeEdge(newPos.x, newPos.y)) {
      player.x = newPos.x;
      player.y = newPos.y;
    }
  }
});

window.addEventListener('keyup', function (e) {
  keysHeld.delete(e.code);

  if (e.code === 'Space') {
    if (drawMode) {
      if (currentLine.length > 0) {
        // SPACEBAR released mid-draw: erase unfinished line, return player to border
        currentLine = [];
        // Snap player to nearest border edge
        const px = snapToGrid(player.x);
        const py = snapToGrid(player.y);

        // Project to nearest border side
        const distLeft   = px - FIELD_LEFT;
        const distRight  = (FIELD_RIGHT - CELL) - px;
        const distTop    = py - FIELD_TOP;
        const distBottom = (FIELD_BOTTOM - CELL) - py;
        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        let bx = px;
        let by = py;
        if (minDist === distLeft)   bx = FIELD_LEFT;
        else if (minDist === distRight)  bx = FIELD_RIGHT - CELL;
        else if (minDist === distTop)    by = FIELD_TOP;
        else                              by = FIELD_BOTTOM - CELL;

        // Clamp to valid range after projection
        const clamped = clampToField(bx, by);
        player.x = clamped.x;
        player.y = clamped.y;
      }
      drawMode = false;
    }
  }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Draw the in-progress Stix line as white filled squares (one per cell).
 */
function renderCurrentLine() {
  if (currentLine.length === 0) return;
  ctx.fillStyle = CGA.WHITE;
  for (const { x, y } of currentLine) {
    ctx.fillRect(x, y, CELL, CELL);
  }
}

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

  // In-progress draw line (drawn before player so player is on top)
  renderCurrentLine();

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
