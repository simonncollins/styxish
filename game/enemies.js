/**
 * enemies.js — Styx enemy AI
 *
 * Exports:
 *   styxEnemies      — array of active Styx enemy objects
 *   initStyxEnemies  — called on game start / level reset
 *   updateStyxEnemies(dt, claimedCells, currentLine, player, onDeath)
 *   renderStyxEnemies(ctx)
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
