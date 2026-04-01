/**
 * enemies.js — Styx enemy AI & Fuse hesitation penalty
 *
 * Exports:
 *   styxEnemies      — array of active Styx enemy objects
 *   initStyxEnemies  — called on game start / level reset
 *   updateStyxEnemies(dt, claimedCells, currentLine, player, onDeath)
 *   renderStyxEnemies(ctx)
 *   fuse                  — fuse state object
 *   resetFuse()
 *   updateFuse(dt, drawMode, playerMoved, stixLine, player, onDeath)
 *   renderFuse(ctx, stixLine, player)
 */

/* ---- Constants (must match engine.js) ------------------------------------ */
const ENEMY_CELL   = 8;
const ENEMY_FIELD_LEFT   = 8;
const ENEMY_FIELD_TOP    = 8;
const ENEMY_FIELD_RIGHT  = 800 - 8;   // CANVAS_W - BORDER_INSET
const ENEMY_FIELD_BOTTOM = 580 - 8;   // CANVAS_H - BORDER_INSET

const STYX_SPEED = 48;   // pixels per second
const STYX_COLORS = ['#00FFFF', '#FF00FF', '#FFFFFF'];   // CGA cycle

/* ---- Helpers ------------------------------------------------------------- */
function snapCell(v) {
  return Math.round(v / ENEMY_CELL) * ENEMY_CELL;
}

function cellKeyE(px, py) {
  const cx = Math.round((px - ENEMY_FIELD_LEFT) / ENEMY_CELL);
  const cy = Math.round((py - ENEMY_FIELD_TOP)  / ENEMY_CELL);
  return `${cx},${cy}`;
}

function isClaimed(px, py, claimedCells) {
  return claimedCells.has(cellKeyE(px, py));
}

function isOuterBorder(px, py) {
  const x = snapCell(px);
  const y = snapCell(py);
  const inH = x >= ENEMY_FIELD_LEFT && x <= ENEMY_FIELD_RIGHT - ENEMY_CELL;
  const inV = y >= ENEMY_FIELD_TOP  && y <= ENEMY_FIELD_BOTTOM - ENEMY_CELL;
  return ((x === ENEMY_FIELD_LEFT || x === ENEMY_FIELD_RIGHT - ENEMY_CELL) && inV) ||
         ((y === ENEMY_FIELD_TOP  || y === ENEMY_FIELD_BOTTOM - ENEMY_CELL) && inH);
}

/** Returns a random axis-aligned unit-cell direction {dx, dy} */
function randomDir() {
  const dirs = [
    { dx:  ENEMY_CELL, dy: 0 },
    { dx: -ENEMY_CELL, dy: 0 },
    { dx: 0, dy:  ENEMY_CELL },
    { dx: 0, dy: -ENEMY_CELL },
  ];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

/** Clamp to interior (not outer border) */
function clampInterior(x, y) {
  return {
    x: Math.max(ENEMY_FIELD_LEFT + ENEMY_CELL,
                Math.min(ENEMY_FIELD_RIGHT  - ENEMY_CELL * 2, snapCell(x))),
    y: Math.max(ENEMY_FIELD_TOP  + ENEMY_CELL,
                Math.min(ENEMY_FIELD_BOTTOM - ENEMY_CELL * 2, snapCell(y))),
  };
}

/** Pick a random unclaimed interior start position */
function randomInteriorPos(claimedCells) {
  const maxTries = 200;
  for (let i = 0; i < maxTries; i++) {
    const fwCells = (ENEMY_FIELD_RIGHT  - ENEMY_FIELD_LEFT) / ENEMY_CELL;
    const fhCells = (ENEMY_FIELD_BOTTOM - ENEMY_FIELD_TOP)  / ENEMY_CELL;
    const cx = 1 + Math.floor(Math.random() * (fwCells - 2));
    const cy = 1 + Math.floor(Math.random() * (fhCells - 2));
    const px = ENEMY_FIELD_LEFT + cx * ENEMY_CELL;
    const py = ENEMY_FIELD_TOP  + cy * ENEMY_CELL;
    if (!isClaimed(px, py, claimedCells) && !isOuterBorder(px, py)) {
      return { x: px, y: py };
    }
  }
  // Fallback: near-centre
  return clampInterior(
    ENEMY_FIELD_LEFT + (ENEMY_FIELD_RIGHT  - ENEMY_FIELD_LEFT) / 2,
    ENEMY_FIELD_TOP  + (ENEMY_FIELD_BOTTOM - ENEMY_FIELD_TOP)  / 2,
  );
}

/* ---- Styx enemy object --------------------------------------------------- */

function createStyx(claimedCells) {
  const pos = randomInteriorPos(claimedCells);
  const dir = randomDir();
  return {
    x: pos.x,
    y: pos.y,
    // sub-pixel accumulator for smooth movement
    acc: 0,
    dx: dir.dx,
    dy: dir.dy,
    // visual: 3–5 line segments per Styx
    numSegments: 3 + Math.floor(Math.random() * 3),
    // angle offset for animation
    angle: Math.random() * Math.PI * 2,
    colorIdx: Math.floor(Math.random() * STYX_COLORS.length),
    colorTimer: 0,
  };
}

/* ---- Module state -------------------------------------------------------- */
const styxEnemies = [];

function initStyxEnemies(level, claimedCells) {
  styxEnemies.length = 0;
  const count = Math.min(1 + (level - 1), 3);
  for (let i = 0; i < count; i++) {
    styxEnemies.push(createStyx(claimedCells));
  }
}

/**
 * Move a single Styx one cell in its current direction.
 * If the destination is a claimed cell, outer border, or out of bounds,
 * pick a new random direction and try again (up to 4 tries).
 */
function moveStyxOneCell(styx, claimedCells) {
  const dirs = [
    { dx: styx.dx, dy: styx.dy },
    ...([
      { dx: ENEMY_CELL, dy: 0 }, { dx: -ENEMY_CELL, dy: 0 },
      { dx: 0, dy: ENEMY_CELL }, { dx: 0, dy: -ENEMY_CELL },
    ].filter(d => d.dx !== styx.dx || d.dy !== styx.dy)
      .sort(() => Math.random() - 0.5)),
  ];

  for (const d of dirs) {
    const nx = styx.x + d.dx;
    const ny = styx.y + d.dy;
    const inBounds =
      nx >= ENEMY_FIELD_LEFT + ENEMY_CELL &&
      nx <= ENEMY_FIELD_RIGHT - ENEMY_CELL * 2 &&
      ny >= ENEMY_FIELD_TOP  + ENEMY_CELL &&
      ny <= ENEMY_FIELD_BOTTOM - ENEMY_CELL * 2;
    if (inBounds && !isClaimed(nx, ny, claimedCells) && !isOuterBorder(nx, ny)) {
      styx.x  = nx;
      styx.y  = ny;
      styx.dx = d.dx;
      styx.dy = d.dy;
      return;
    }
  }
  // Completely boxed in — stay put and pick new random dir
  const d = randomDir();
  styx.dx = d.dx;
  styx.dy = d.dy;
}

/**
 * Update all Styx enemies.
 *
 * @param {number} dt             - Delta time in seconds
 * @param {Set<string>} claimedCells - Claimed cell keys from engine
 * @param {Array<{x,y}>} currentLine - Player's in-progress draw line
 * @param {{x,y}} player         - Player position
 * @param {function} onDeath     - Callback: called when Styx hits in-progress line
 */
function updateStyxEnemies(dt, claimedCells, currentLine, player, onDeath) {
  for (const styx of styxEnemies) {
    // Advance animation angle
    styx.angle += dt * 3.5;

    // Color cycling
    styx.colorTimer += dt;
    if (styx.colorTimer > 0.12) {
      styx.colorTimer = 0;
      styx.colorIdx = (styx.colorIdx + 1) % STYX_COLORS.length;
    }

    // Movement (cell-based with sub-pixel accumulation for smooth pacing)
    styx.acc += STYX_SPEED * dt;
    while (styx.acc >= ENEMY_CELL) {
      styx.acc -= ENEMY_CELL;
      moveStyxOneCell(styx, claimedCells);
    }

    // Collision: does Styx overlap any cell of the in-progress draw line?
    if (currentLine.length > 0) {
      const hit = currentLine.some(
        p => Math.abs(p.x - styx.x) < ENEMY_CELL && Math.abs(p.y - styx.y) < ENEMY_CELL
      );
      if (hit) {
        onDeath();
      }
    }
  }
}

/**
 * Render all Styx enemies as animated bundles of intersecting lines.
 * @param {CanvasRenderingContext2D} ctx
 */
function renderStyxEnemies(ctx) {
  for (const styx of styxEnemies) {
    const cx = styx.x + ENEMY_CELL / 2;
    const cy = styx.y + ENEMY_CELL / 2;
    const len = ENEMY_CELL * 1.2;

    ctx.save();
    ctx.lineWidth = 1.5;

    for (let i = 0; i < styx.numSegments; i++) {
      const theta = styx.angle + (i * Math.PI) / styx.numSegments;
      const color = STYX_COLORS[(styx.colorIdx + i) % STYX_COLORS.length];
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(theta) * len,       cy + Math.sin(theta) * len);
      ctx.lineTo(cx + Math.cos(theta + Math.PI) * len, cy + Math.sin(theta + Math.PI) * len);
      ctx.stroke();
    }

    ctx.restore();
  }
}


/* ---- Constants ---------------------------------------------------------- */
const FUSE_HESITATION_DELAY = 0.5;   // seconds before fuse ignites after player stops
const FUSE_SPEED            = 64;    // pixels per second along the stix line
const FUSE_FLICKER_INTERVAL = 0.05;  // seconds between color flicker alternations

const FUSE_COLOR_A = '#FFFFFF';  // CGA white
const FUSE_COLOR_B = '#00FFFF';  // CGA cyan

/* ---- Fuse state ---------------------------------------------------------- */
const fuse = {
  active:       false,    // is the fuse currently visible/advancing?
  position:     0,        // current position as a float index into stixLine[]
  hesitTimer:   0,        // time the player has been stationary in draw mode
  flickerTimer: 0,        // time accumulator for color alternation
  flickerOn:    true,     // which flicker color to show
  paused:       false,    // true when player is moving (fuse pauses)
};

/* ---- Public API ---------------------------------------------------------- */

/** Extinguish the fuse (line completed, draw mode exited, or player died). */
function resetFuse() {
  fuse.active      = false;
  fuse.position    = 0;
  fuse.hesitTimer  = 0;
  fuse.flickerTimer = 0;
  fuse.flickerOn   = true;
  fuse.paused      = false;
}

/**
 * Update the fuse state each frame.
 *
 * @param {number} dt              - Delta time in seconds
 * @param {boolean} drawMode       - Whether the player is currently in draw mode
 * @param {boolean} playerMoved    - Whether the player moved this frame
 * @param {Array<{x,y}>} stixLine  - The current in-progress draw line
 * @param {{x,y}} player           - Current player position
 * @param {function} onDeath       - Callback when fuse reaches the player
 */
function updateFuse(dt, drawMode, playerMoved, stixLine, player, onDeath) {
  // Fuse is only relevant in draw mode with a line in progress
  if (!drawMode || stixLine.length === 0) {
    resetFuse();
    return;
  }

  // Build the full path: stixLine + player's current position as endpoint
  // stixLine[0] is the start (on border), stixLine[last] leads to player
  const fullPath = [...stixLine, { x: player.x, y: player.y }];
  const pathLen  = fullPath.length; // number of points

  // Track hesitation
  if (playerMoved) {
    // Player is moving — pause the fuse, reset hesitation clock
    fuse.hesitTimer = 0;
    fuse.paused     = true;
  } else {
    // Player is stationary
    fuse.paused = false;
    fuse.hesitTimer += dt;

    if (!fuse.active && fuse.hesitTimer >= FUSE_HESITATION_DELAY) {
      // Ignite! Fuse starts at position 0 (beginning of stixLine)
      fuse.active   = true;
      fuse.position = 0;
    }
  }

  if (!fuse.active) return;
  if (fuse.paused) return;

  // Advance fuse along the path
  // Convert pixel speed to index advance: each step is CELL=8px apart,
  // but we track by point index so advance = FUSE_SPEED/8 indices per second
  const CELL_SIZE = 8;
  fuse.position += (FUSE_SPEED / CELL_SIZE) * dt;

  // Clamp to path end
  if (fuse.position >= pathLen - 1) {
    fuse.position = pathLen - 1;
    // Reached the player
    onDeath();
    resetFuse();
    return;
  }

  // Flicker update
  fuse.flickerTimer += dt;
  if (fuse.flickerTimer >= FUSE_FLICKER_INTERVAL) {
    fuse.flickerTimer = 0;
    fuse.flickerOn    = !fuse.flickerOn;
  }
}

/**
 * Render the fuse as a flickering pixel on the stix line.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x,y}>} stixLine
 * @param {{x,y}} player
 */
function renderFuse(ctx, stixLine, player) {
  if (!fuse.active || stixLine.length === 0) return;

  const fullPath = [...stixLine, { x: player.x, y: player.y }];
  const idx      = Math.floor(fuse.position);
  const point    = fullPath[Math.min(idx, fullPath.length - 1)];

  const CELL_SIZE = 8;
  const color = fuse.flickerOn ? FUSE_COLOR_A : FUSE_COLOR_B;

  // Draw the fuse as a bright 2×2 pixel cluster
  ctx.fillStyle = color;
  ctx.fillRect(point.x + CELL_SIZE / 2 - 1, point.y + CELL_SIZE / 2 - 1, 3, 3);

  // Draw a faint trail behind the fuse (last 3 path points)
  for (let i = 1; i <= 3; i++) {
    const trailIdx = Math.max(0, idx - i);
    const tp = fullPath[trailIdx];
    ctx.globalAlpha = 0.4 - i * 0.1;
    ctx.fillStyle   = color;
    ctx.fillRect(tp.x + CELL_SIZE / 2 - 1, tp.y + CELL_SIZE / 2 - 1, 2, 2);
  }
  ctx.globalAlpha = 1.0;
}
