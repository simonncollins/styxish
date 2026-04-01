/**
 * engine.js — Styx core game engine
 * Canvas setup, 60fps game loop, CGA palette constants,
 * player movement (issue #3), draw mode & Stix line rendering (issue #4),
 * flood-fill territory claiming & HUD (issue #5),
 * Styx field enemy (issue #11),
 * Worm border patrol enemy (issue #12),
 * Fuse hesitation penalty (issue #13),
 * Collision detection & life system (issue #14).
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
// Game state
// ---------------------------------------------------------------------------

let lives = 3;
let level = 1;
let gameOver = false;
let levelTransition = false;  // true while level-complete overlay is showing
let levelOverlayTimer = 0;    // seconds remaining for transition overlay
// ---------------------------------------------------------------------------
// Scoring & cycling multiplier (issue #21)
// ---------------------------------------------------------------------------

/** Base score awarded per percentage-point of territory claimed */
const SCORE_BASE = 100;

/** Multiplier cycle sequence (1x -> 5x -> 10x -> 1x ...) */
const MULTIPLIER_VALUES = [1, 5, 10];

/** Display colours for each multiplier index */
const MULTIPLIER_COLORS = [CGA.WHITE, CGA.CYAN, CGA.MAGENTA];

/** Seconds per multiplier step */
const MULTIPLIER_CYCLE_SECONDS = 2.0;

let score = 0;
let multiplierIndex = 0;
let multiplierTimer = 0;


/**
 * Invulnerability timer (seconds remaining after a death).
 * While > 0, triggerDeath() is a no-op — prevents double-kills.
 */
let invulnTimer = 0;

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

/** Whether the player moved this frame (used by fuse logic). */
let playerMovedThisFrame = false;

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
// Helper: find nearest border position to (px, py) using Euclidean distance.
// Searches all 4 edges and returns the closest grid-snapped position.
// ---------------------------------------------------------------------------
function nearestBorderPosition(px, py) {
  let bestDist = Infinity;
  let bestX = FIELD_LEFT;
  let bestY = FIELD_TOP;

  function check(bx, by) {
    const dx = px - bx;
    const dy = py - by;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestX = bx;
      bestY = by;
    }
  }

  // Top edge
  for (let x = FIELD_LEFT; x <= FIELD_RIGHT - CELL; x += CELL) check(x, FIELD_TOP);
  // Bottom edge
  for (let x = FIELD_LEFT; x <= FIELD_RIGHT - CELL; x += CELL) check(x, FIELD_BOTTOM - CELL);
  // Left edge (skip corners already covered)
  for (let y = FIELD_TOP + CELL; y <= FIELD_BOTTOM - CELL * 2; y += CELL) check(FIELD_LEFT, y);
  // Right edge
  for (let y = FIELD_TOP + CELL; y <= FIELD_BOTTOM - CELL * 2; y += CELL) check(FIELD_RIGHT - CELL, y);

  return { x: bestX, y: bestY };
}

// ---------------------------------------------------------------------------
// Death & reset
// ---------------------------------------------------------------------------

/**
 * Handle player death: lose a life, reset draw state, snap player to nearest
 * border position, start invulnerability window.
 * No-op if invulnerability window is still active.
 */
function triggerDeath() {
  if (invulnTimer > 0) return;  // still invulnerable — ignore

  lives -= 1;
  currentLine = [];
  drawMode = false;
  playerMovedThisFrame = false;
  resetFuse();
  multiplierIndex = 0;
  multiplierTimer = 0;

  if (lives <= 0) {
    gameOver = true;
    player.x = FIELD_LEFT;
    player.y = FIELD_TOP;
    window.dispatchEvent(new CustomEvent('game-over'));
    return;
  }

  // Respawn at nearest border position
  const respawn = nearestBorderPosition(player.x, player.y);
  player.x = respawn.x;
  player.y = respawn.y;

  // 1.5s invulnerability window
  invulnTimer = 1.5;
}

// ---------------------------------------------------------------------------
// Full game reset (called on play-again)
// ---------------------------------------------------------------------------
function resetGame() {
  lives = 3;
  level = 1;
  gameOver = false;
  invulnTimer = 0;
  levelTransition = false;
  levelOverlayTimer = 0;
  currentLine = [];
  drawMode = false;
  playerMovedThisFrame = false;
  claimedCells.clear();
  player.x = FIELD_LEFT;
  player.y = FIELD_TOP;
  resetFuse();
  initStyxEnemies(level, claimedCells);
  initWormEnemies(level, claimedCells);
}

// ---------------------------------------------------------------------------
// Flood-fill territory claiming
// ---------------------------------------------------------------------------
function floodFillClaim(borderLine, enemyPosition = null) {
  // 1. Add borderLine pixels to claimedCells (they become the new wall)
  borderLine.forEach(({ x, y }) => {
    claimedCells.add(cellKey(x, y));
  });

  // 2. Build barrier set: outer border rows/cols + all claimed cells
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

  // Award score: claimedArea% x baseScore x multiplier
  const claimedPct = (claimedCells.size / TOTAL_PLAYFIELD_CELLS) * 100;
  const mult = MULTIPLIER_VALUES[multiplierIndex];
  score += Math.round(claimedPct * SCORE_BASE * mult);

  checkLevelComplete();
}

// ---------------------------------------------------------------------------
// Start next level: reset territory to border-only and respawn enemies
// ---------------------------------------------------------------------------
function startNextLevel() {
  // Reset claimed territory: keep only the outer border cells
  claimedCells.clear();
  for (let cx = 0; cx < FIELD_W_CELLS; cx++) {
    claimedCells.add(`${cx},0`);
    claimedCells.add(`${cx},${FIELD_H_CELLS - 1}`);
  }
  for (let cy = 1; cy < FIELD_H_CELLS - 1; cy++) {
    claimedCells.add(`0,${cy}`);
    claimedCells.add(`${FIELD_W_CELLS - 1},${cy}`);
  }
  currentLine = [];
  drawMode = false;
  playerMovedThisFrame = false;
  player.x = FIELD_LEFT;
  player.y = FIELD_TOP;
  resetFuse();
  multiplierIndex = 0;
  multiplierTimer = 0;
  initStyxEnemies(level, claimedCells);
  initWormEnemies(level, claimedCells);
  levelTransition = false;
}

// ---------------------------------------------------------------------------
// Check and dispatch level-complete event
// ---------------------------------------------------------------------------
function checkLevelComplete() {
  if (levelTransition) return;  // already transitioning — don't fire again
  const percentage = (claimedCells.size / TOTAL_PLAYFIELD_CELLS) * 100;
  if (percentage >= 80) {
    window.dispatchEvent(new CustomEvent('level-complete', {
      detail: { percentage: percentage.toFixed(1) },
    }));
  }
}

// ---------------------------------------------------------------------------
// Level-complete event listener
// ---------------------------------------------------------------------------
window.addEventListener('level-complete', function () {
  level += 1;
  levelTransition = true;
  levelOverlayTimer = 1.5;
});


// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------
window.addEventListener('keydown', function (e) {
  keysHeld.add(e.code);

  // Prevent page scroll from arrow keys and space
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
    e.preventDefault();
  }

  // Play-again: R key resets game when game over
  if (gameOver && e.code === 'KeyR') {
    resetGame();
    return;
  }

  if (gameOver) return;

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
      // Pass Styx position so fill avoids trapping enemies
      const enemyPos = styxEnemies.length > 0 ? { x: styxEnemies[0].x, y: styxEnemies[0].y } : null;
      floodFillClaim(completedLine, enemyPos);
    } else {
      // Extend the line: record current position before moving
      currentLine.push({ x: player.x, y: player.y });
      player.x = newPos.x;
      player.y = newPos.y;
      playerMovedThisFrame = true;
    }
  } else {
    // Normal mode: only allow movement along safe edges
    if (isOnSafeEdge(newPos.x, newPos.y)) {
      player.x = newPos.x;
      player.y = newPos.y;
      playerMovedThisFrame = true;
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

// Play-again: click canvas when game over
canvas.addEventListener('click', function () {
  if (gameOver) {
    resetGame();
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
 * Draw the player as a MAGENTA filled square.
 */
function renderPlayer() {
  // Flash the player during invulnerability window (toggle at ~8 Hz)
  if (invulnTimer > 0) {
    const flash = Math.floor(invulnTimer * 8) % 2 === 0;
    if (!flash) return;
  }
  ctx.fillStyle = CGA.MAGENTA;
  ctx.fillRect(player.x, player.y, CELL, CELL);
}

/**
 * Draw the territory percentage, level, and lives HUD.
 * Lives are shown as small MAGENTA player-icon squares.
 */
function renderHUD() {
  const percentage = ((claimedCells.size / TOTAL_PLAYFIELD_CELLS) * 100).toFixed(1);
  ctx.fillStyle = CGA.WHITE;
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`Territory: ${percentage}%`, FIELD_LEFT + 4, FIELD_TOP - 2);
  ctx.fillText(`Level: ${level}`, FIELD_LEFT + 160, FIELD_TOP - 2);
  ctx.fillText(`Score: ${score}`, FIELD_LEFT + 260, FIELD_TOP - 2);

  // Cycling multiplier block -- left of the lives icons
  const multVal   = MULTIPLIER_VALUES[multiplierIndex];
  const multColor = MULTIPLIER_COLORS[multiplierIndex];
  const blockSize = CELL + 2;
  const multX = FIELD_RIGHT - (lives * (CELL + 2)) - blockSize - 16;
  const multY = BORDER_INSET - blockSize;
  ctx.fillStyle = multColor;
  ctx.fillRect(multX, multY, blockSize, blockSize);
  ctx.fillStyle = CGA.BLACK;
  ctx.font = 'bold 9px monospace';
  ctx.fillText(`${multVal}x`, multX + 1, multY + 9);

  // Lives as MAGENTA block icons in the top-right
  const iconSize = CELL;
  const iconGap  = 2;
  const baseX    = FIELD_RIGHT - (lives * (iconSize + iconGap));
  const baseY    = BORDER_INSET - iconSize - 1;
  ctx.fillStyle = CGA.MAGENTA;
  for (let i = 0; i < lives; i++) {
    ctx.fillRect(baseX + i * (iconSize + iconGap), baseY, iconSize, iconSize);
  }
}

function renderLevelTransition() {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = CGA.CYAN;
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`LEVEL ${level}`, CANVAS_W / 2, CANVAS_H / 2 - 20);
  ctx.fillStyle = CGA.WHITE;
  ctx.font = 'bold 16px monospace';
  ctx.fillText('GET READY!', CANVAS_W / 2, CANVAS_H / 2 + 20);
  ctx.textAlign = 'left';
}

function renderGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = CGA.MAGENTA;
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2);
  ctx.fillStyle = CGA.WHITE;
  ctx.font = 'bold 16px monospace';
  ctx.fillText('Press R or click to play again', CANVAS_W / 2, CANVAS_H / 2 + 36);
  ctx.textAlign = 'left';
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

  // Fuse (on top of line, below player)
  renderFuse(ctx, currentLine, player);

  // Styx enemies
  renderStyxEnemies(ctx);

  // Worm enemies
  renderWormEnemies(ctx);

  // Player (on top)
  renderPlayer();

  // HUD overlay
  renderHUD();

  if (levelTransition) {
    renderLevelTransition();
  }
  if (gameOver) {
    renderGameOver();
  }
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
let lastTime = null;

function gameLoop(timestamp) {
  const dt = lastTime === null ? 0 : Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  if (!gameOver) {
    // Handle level transition timer
    if (levelTransition) {
      levelOverlayTimer = Math.max(0, levelOverlayTimer - dt);
      if (levelOverlayTimer <= 0) {
        startNextLevel();
      }
    } else {
      // Tick down invulnerability timer
      if (invulnTimer > 0) {
        invulnTimer = Math.max(0, invulnTimer - dt);
      // Advance cycling multiplier
      multiplierTimer += dt;
      if (multiplierTimer >= MULTIPLIER_CYCLE_SECONDS) {
        multiplierTimer -= MULTIPLIER_CYCLE_SECONDS;
        multiplierIndex = (multiplierIndex + 1) % MULTIPLIER_VALUES.length;
      }
      }

      updateFuse(dt, drawMode, playerMovedThisFrame, currentLine, player, triggerDeath);
      updateStyxEnemies(dt, claimedCells, currentLine, player, triggerDeath, level);
      updateWormEnemies(dt, claimedCells, player, triggerDeath, level);
    }
  }

  // Reset per-frame movement flag after fuse has read it
  playerMovedThisFrame = false;

  render();
  requestAnimationFrame(gameLoop);
}

// Kick off the loop once the page is ready
window.addEventListener('load', function () {
  initStyxEnemies(level, claimedCells);
  initWormEnemies(level, claimedCells);
  requestAnimationFrame(gameLoop);
});
