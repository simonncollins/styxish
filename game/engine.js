/**
 * engine.js — Styx core game engine
 * Canvas setup, 60fps game loop, CGA palette constants,
 * player movement (issue #3), draw mode & Stix line rendering (issue #4),
 * flood-fill territory claiming & HUD (issue #5).
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

// Grid dimensions (number of CELL-sized slots across the playfield including border)
const FIELD_W_CELLS = (FIELD_RIGHT - FIELD_LEFT) / CELL;
const FIELD_H_CELLS = (FIELD_BOTTOM - FIELD_TOP) / CELL;

/**
 * Total interior (non-border) cells — used for percentage calculation.
 * Subtract 2 on each axis to exclude the 1-cell-wide border row/column.
 */
const TOTAL_PLAYFIELD_CELLS = (FIELD_W_CELLS - 2) * (FIELD_H_CELLS - 2);

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
 */
let currentLine = [];

/** True when SPACEBAR is held and player is in draw mode. */
let drawMode = false;

/**
 * Claimed territory cells.
 * Set of "cx,cy" grid-coordinate keys (not pixel coords).
 * cx/cy are cell indices relative to FIELD_LEFT/FIELD_TOP.
 */
const claimedCells = new Set();

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
// Helper: convert pixel position to grid cell coordinates
// ---------------------------------------------------------------------------
function pixelToCell(px, py) {
  return {
    cx: Math.round((px - FIELD_LEFT) / CELL),
    cy: Math.round((py - FIELD_TOP)  / CELL),
  };
}

// ---------------------------------------------------------------------------
// Helper: cell key from pixel position
// ---------------------------------------------------------------------------
function cellKey(px, py) {
  const { cx, cy } = pixelToCell(px, py);
  return `${cx},${cy}`;
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
// Helper: is (px, py) on the edge of claimed territory?
// A claimed cell is an "edge" if at least one of its 4 cardinal neighbours
// is an unclaimed interior cell.
// ---------------------------------------------------------------------------
function isOnClaimedEdge(px, py) {
  const k = cellKey(px, py);
  if (!claimedCells.has(k)) return false;
  const { cx, cy } = pixelToCell(px, py);
  const neighbours = [
    `${cx-1},${cy}`, `${cx+1},${cy}`,
    `${cx},${cy-1}`, `${cx},${cy+1}`,
  ];
  return neighbours.some(nk => !claimedCells.has(nk));
}

// ---------------------------------------------------------------------------
// Helper: is (px, py) a valid position for normal (non-draw) movement?
// Includes outer border and edges of claimed territory.
// ---------------------------------------------------------------------------
function isOnSafeEdge(px, py) {
  return isOnOuterBorder(px, py) || isOnClaimedEdge(px, py);
}

// ---------------------------------------------------------------------------
// Flood-fill territory claiming
//
// @param {Array<{x:number, y:number}>} borderLine
//   The newly completed Stix border line (pixel positions of drawn cells).
//   These cells form the new border between claimed and unclaimed territory.
//
// @param {{x:number, y:number}|null} enemyPosition
//   Optional enemy position in pixel coordinates.
//
//   PHASE 1 (no enemies): pass null — the function fills the SMALLER of the
//   two regions enclosed by the new border line + existing claimed territory.
//   Smaller-region fill is the authentic Styx mechanic (maximises risk/reward).
//
//   PHASE 2 (enemies): pass the enemy's current {x, y}.
//   The function fills the region that does NOT contain the enemy, ensuring
//   the enemy is never trapped in claimed territory. If the enemy is on a
//   barrier cell (already claimed), all enclosed regions are safe to fill.
//   If multiple safe regions exist, the largest is chosen to reward the player.
//
//   Example Phase 2 call:
//     floodFillClaim(completedLine, { x: enemy.x, y: enemy.y });
// ---------------------------------------------------------------------------
function floodFillClaim(borderLine, enemyPosition = null) {
  // 1. Add borderLine pixels to claimedCells (they become the new wall)
  borderLine.forEach(({ x, y }) => {
    claimedCells.add(cellKey(x, y));
  });

  // 2. Build barrier set: outer border rows/cols + all claimed cells
  //    Barrier = cannot be filled; flood-fill stays inside barriers.
  const barriers = new Set(claimedCells);
  for (let cx = 0; cx < FIELD_W_CELLS; cx++) {
    barriers.add(`${cx},0`);
    barriers.add(`${cx},${FIELD_H_CELLS - 1}`);
  }
  for (let cy = 0; cy < FIELD_H_CELLS; cy++) {
    barriers.add(`0,${cy}`);
    barriers.add(`${FIELD_W_CELLS - 1},${cy}`);
  }

  // 3. Flood-fill all distinct interior regions (BFS per unvisited seed)
  const visited = new Set();
  const regions = [];

  function bfs(startCx, startCy) {
    const region = new Set();
    const queue = [[startCx, startCy]];
    const startKey = `${startCx},${startCy}`;
    visited.add(startKey);
    region.add(startKey);
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
        const nk = `${nx},${ny}`;
        if (!visited.has(nk) && !barriers.has(nk) &&
            nx >= 1 && nx < FIELD_W_CELLS - 1 &&
            ny >= 1 && ny < FIELD_H_CELLS - 1) {
          visited.add(nk);
          region.add(nk);
          queue.push([nx, ny]);
        }
      }
    }
    return region;
  }

  for (let cx = 1; cx < FIELD_W_CELLS - 1; cx++) {
    for (let cy = 1; cy < FIELD_H_CELLS - 1; cy++) {
      const k = `${cx},${cy}`;
      if (!visited.has(k) && !barriers.has(k)) {
        regions.push(bfs(cx, cy));
      }
    }
  }

  if (regions.length === 0) {
    checkLevelComplete();
    return;
  }

  // 4. Choose which region to fill
  let regionToFill;

  if (enemyPosition !== null) {
    // Phase 2: avoid the region containing the enemy
    const ek = cellKey(enemyPosition.x, enemyPosition.y);
    const enemyRegionIdx = regions.findIndex(r => r.has(ek));

    if (enemyRegionIdx === -1) {
      // Enemy is on a barrier — all regions are safe; pick the largest
      regionToFill = regions.reduce((a, b) => a.size >= b.size ? a : b);
    } else {
      // Filter out the enemy's region; pick the largest remaining safe region
      const safeRegions = regions.filter((_, i) => i !== enemyRegionIdx);
      if (safeRegions.length === 0) {
        checkLevelComplete();
        return;
      }
      regionToFill = safeRegions.reduce((a, b) => a.size >= b.size ? a : b);
    }
  } else {
    // Phase 1: fill the smaller region (authentic Styx behaviour)
    regionToFill = regions.reduce((a, b) => a.size <= b.size ? a : b);
  }

  // 5. Claim the chosen region
  regionToFill.forEach(k => claimedCells.add(k));

  checkLevelComplete();
}

// ---------------------------------------------------------------------------
// Check and dispatch level-complete event
// ---------------------------------------------------------------------------
function checkLevelComplete() {
  const percentage = (claimedCells.size / TOTAL_PLAYFIELD_CELLS) * 100;
  if (percentage >= 80) {
    window.dispatchEvent(new CustomEvent('level-complete', {
      detail: { percentage: percentage.toFixed(1) },
    }));
  }
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

  // SPACEBAR activates draw mode
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
      // Line complete — trigger flood-fill and reset draw state
      currentLine.push({ x: newPos.x, y: newPos.y });
      player.x = newPos.x;
      player.y = newPos.y;
      const completedLine = currentLine.slice();
      currentLine = [];
      drawMode = false;
      floodFillClaim(completedLine, null);
    } else {
      // Extend the line: record current position before moving
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
        // SPACEBAR released mid-draw: erase line, snap player to nearest border
        currentLine = [];
        const px = snapToGrid(player.x);
        const py = snapToGrid(player.y);

        // Project to nearest border side by Manhattan distance
        const distLeft   = px - FIELD_LEFT;
        const distRight  = (FIELD_RIGHT - CELL) - px;
        const distTop    = py - FIELD_TOP;
        const distBottom = (FIELD_BOTTOM - CELL) - py;
        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        let bx = px;
        let by = py;
        if      (minDist === distLeft)   bx = FIELD_LEFT;
        else if (minDist === distRight)  bx = FIELD_RIGHT - CELL;
        else if (minDist === distTop)    by = FIELD_TOP;
        else                             by = FIELD_BOTTOM - CELL;

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
 * Draw all claimed territory cells as cyan 8×8 squares.
 */
function renderClaimedTerritory() {
  ctx.fillStyle = CGA.CYAN;
  claimedCells.forEach(k => {
    const [cx, cy] = k.split(',').map(Number);
    const px = FIELD_LEFT + cx * CELL;
    const py = FIELD_TOP  + cy * CELL;
    ctx.fillRect(px, py, CELL, CELL);
  });
}

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

/**
 * Draw the territory percentage HUD (white monospace text, top of canvas).
 */
function renderHUD() {
  const percentage = ((claimedCells.size / TOTAL_PLAYFIELD_CELLS) * 100).toFixed(1);
  ctx.fillStyle = CGA.WHITE;
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`Territory: ${percentage}%`, FIELD_LEFT + 4, FIELD_TOP - 2);
}

function render() {
  // Clear with black background
  ctx.fillStyle = CGA.BLACK;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Claimed territory (below the border line)
  renderClaimedTerritory();

  // White playfield border rectangle
  ctx.strokeStyle = CGA.WHITE;
  ctx.lineWidth   = 2;
  ctx.strokeRect(
    BORDER_INSET,
    BORDER_INSET,
    CANVAS_W - BORDER_INSET * 2,
    CANVAS_H - BORDER_INSET * 2
  );

  // In-progress draw line (beneath player)
  renderCurrentLine();

  // Player (on top)
  renderPlayer();

  // HUD overlay
  renderHUD();
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
