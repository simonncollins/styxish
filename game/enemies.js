/**
 * enemies.js — Styx enemy AI & Worm border patrol enemy
 *
 * Exports:
 *   styxEnemies      — array of active Styx enemy objects
 *   initStyxEnemies  — called on game start / level reset
 *   updateStyxEnemies(dt, claimedCells, currentLine, player, onDeath)
 *   renderStyxEnemies(ctx)
 *   wormEnemies      — array of active Worm objects
 *   initWormEnemies(level, claimedCells)
 *   updateWormEnemies(dt, claimedCells, player, onDeath)
 *   renderWormEnemies(ctx)
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


// Base speed in pixels/second; increases with level
const WORM_BASE_SPEED  = 64;
const WORM_SPEED_DELTA = 16;  // additional px/s per level
const WORM_SEGMENTS    = 4;   // number of body segments (including head)

// Worm colors (CGA)
const WORM_HEAD_COLOR = '#FFFFFF';
const WORM_BODY_COLOR = '#FF00FF';

/* ---- Helpers ------------------------------------------------------------- */
function wSnapCell(v) {
  return Math.round(v / ENEMY_CELL) * ENEMY_CELL;
}

function wCellKey(px, py) {
  const cx = Math.round((px - ENEMY_FIELD_LEFT) / ENEMY_CELL);
  const cy = Math.round((py - ENEMY_FIELD_TOP)  / ENEMY_CELL);
  return `${cx},${cy}`;
}

/**
 * Build the full set of perimeter positions (outer border + claimed edges)
 * as an ordered list of {x, y} pixel coords for worm traversal.
 *
 * We trace the outer border clockwise, then append claimed-edge cells
 * adjacent to the outer already-collected path.
 */
function buildPerimeterList(claimedCells) {
  const perimeter = [];
  const seen = new Set();

  function add(px, py) {
    const k = wCellKey(px, py);
    if (seen.has(k)) return;
    seen.add(k);
    perimeter.push({ x: px, y: py });
  }

  // Outer border: top row left→right
  for (let x = ENEMY_FIELD_LEFT; x <= ENEMY_FIELD_RIGHT - ENEMY_CELL; x += ENEMY_CELL) {
    add(x, ENEMY_FIELD_TOP);
  }
  // Right column top→bottom
  for (let y = ENEMY_FIELD_TOP; y <= ENEMY_FIELD_BOTTOM - ENEMY_CELL; y += ENEMY_CELL) {
    add(ENEMY_FIELD_RIGHT - ENEMY_CELL, y);
  }
  // Bottom row right→left
  for (let x = ENEMY_FIELD_RIGHT - ENEMY_CELL; x >= ENEMY_FIELD_LEFT; x -= ENEMY_CELL) {
    add(x, ENEMY_FIELD_BOTTOM - ENEMY_CELL);
  }
  // Left column bottom→top
  for (let y = ENEMY_FIELD_BOTTOM - ENEMY_CELL; y >= ENEMY_FIELD_TOP; y -= ENEMY_CELL) {
    add(y === ENEMY_FIELD_TOP ? 0 : ENEMY_FIELD_LEFT, y); // avoid double-add corner
    // Fix: just use correct x
  }

  // Rebuild left column properly
  // (redo — the above had a bug; just do a clean ordered traversal)
  return buildCleanPerimeter(claimedCells);
}

function buildCleanPerimeter(claimedCells) {
  const positions = [];
  const seen = new Set();

  function tryAdd(px, py) {
    const k = `${px},${py}`;
    if (seen.has(k)) return;
    seen.add(k);
    positions.push({ x: px, y: py });
  }

  // Outer border clockwise
  for (let x = ENEMY_FIELD_LEFT; x < ENEMY_FIELD_RIGHT; x += ENEMY_CELL)
    tryAdd(x, ENEMY_FIELD_TOP);
  for (let y = ENEMY_FIELD_TOP; y < ENEMY_FIELD_BOTTOM; y += ENEMY_CELL)
    tryAdd(ENEMY_FIELD_RIGHT - ENEMY_CELL, y);
  for (let x = ENEMY_FIELD_RIGHT - ENEMY_CELL; x >= ENEMY_FIELD_LEFT; x -= ENEMY_CELL)
    tryAdd(x, ENEMY_FIELD_BOTTOM - ENEMY_CELL);
  for (let y = ENEMY_FIELD_BOTTOM - ENEMY_CELL; y > ENEMY_FIELD_TOP; y -= ENEMY_CELL)
    tryAdd(ENEMY_FIELD_LEFT, y);

  // Claimed-edge cells (cells that are claimed but adjoin unclaimed interior)
  if (claimedCells && claimedCells.size > 0) {
    const fieldWCells = (ENEMY_FIELD_RIGHT - ENEMY_FIELD_LEFT) / ENEMY_CELL;
    const fieldHCells = (ENEMY_FIELD_BOTTOM - ENEMY_FIELD_TOP) / ENEMY_CELL;
    for (let cx = 1; cx < fieldWCells - 1; cx++) {
      for (let cy = 1; cy < fieldHCells - 1; cy++) {
        const k = `${cx},${cy}`;
        if (!claimedCells.has(k)) continue;
        // Check cardinal neighbours for unclaimed interior
        const neighbours = [
          [cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],
        ];
        const isEdge = neighbours.some(([nx, ny]) => {
          if (nx < 1 || ny < 1 || nx >= fieldWCells-1 || ny >= fieldHCells-1) return false;
          return !claimedCells.has(`${nx},${ny}`);
        });
        if (isEdge) {
          const px = ENEMY_FIELD_LEFT + cx * ENEMY_CELL;
          const py = ENEMY_FIELD_TOP  + cy * ENEMY_CELL;
          tryAdd(px, py);
        }
      }
    }
  }

  return positions;
}

/* ---- Worm object --------------------------------------------------------- */

function createWorm(perimeterList, offset) {
  // segments[0] = head; segments[N] = tail
  const startIdx = offset % perimeterList.length;
  const segments = [];
  for (let i = 0; i < WORM_SEGMENTS; i++) {
    const idx = (startIdx - i + perimeterList.length) % perimeterList.length;
    segments.push({ ...perimeterList[idx] });
  }
  return {
    segments,
    perimIdx: startIdx,   // index of head in perimeter list
    acc: 0,
    // direction: +1 = forward along perimeter, -1 = backward
    dir: Math.random() < 0.5 ? 1 : -1,
    // how long until next direction change
    dirTimer: 2 + Math.random() * 4,
  };
}

/* ---- Module state -------------------------------------------------------- */
const wormEnemies = [];
let _cachedPerimeter = [];

function initWormEnemies(level, claimedCells) {
  wormEnemies.length = 0;
  _cachedPerimeter = buildCleanPerimeter(claimedCells);
  const count = Math.min(1 + (level - 1), 3);
  for (let i = 0; i < count; i++) {
    const offset = Math.floor((_cachedPerimeter.length / count) * i);
    wormEnemies.push(createWorm(_cachedPerimeter, offset));
  }
}

/**
 * Update worm positions and check player collision.
 *
 * @param {number} dt
 * @param {Set<string>} claimedCells
 * @param {{x,y}} player
 * @param {function} onDeath
 */
function updateWormEnemies(dt, claimedCells, player, onDeath, level = 1) {
  // Rebuild perimeter on claimed-territory changes
  _cachedPerimeter = buildCleanPerimeter(claimedCells);
  if (_cachedPerimeter.length === 0) return;

  const speed = WORM_BASE_SPEED + (level - 1) * WORM_SPEED_DELTA;

  for (const worm of wormEnemies) {
    // Direction change timer
    worm.dirTimer -= dt;
    if (worm.dirTimer <= 0) {
      worm.dir = -worm.dir;
      worm.dirTimer = 2 + Math.random() * 4;
    }

    // Advance by speed * dt cells
    worm.acc += speed * dt;
    while (worm.acc >= ENEMY_CELL) {
      worm.acc -= ENEMY_CELL;
      // Move head one step along perimeter
      worm.perimIdx = (worm.perimIdx + worm.dir + _cachedPerimeter.length) % _cachedPerimeter.length;
      const headPos = _cachedPerimeter[worm.perimIdx];

      // Shift segments: new head, drop last
      worm.segments.unshift({ x: headPos.x, y: headPos.y });
      worm.segments.length = WORM_SEGMENTS;
    }

    // Collision with player (any segment)
    const hit = worm.segments.some(
      s => Math.abs(s.x - player.x) < ENEMY_CELL && Math.abs(s.y - player.y) < ENEMY_CELL
    );
    if (hit) {
      onDeath();
    }
  }
}

/**
 * Render worm enemies.
 * @param {CanvasRenderingContext2D} ctx
 */
function renderWormEnemies(ctx) {
  for (const worm of wormEnemies) {
    for (let i = 0; i < worm.segments.length; i++) {
      const seg = worm.segments[i];
      ctx.fillStyle = i === 0 ? WORM_HEAD_COLOR : WORM_BODY_COLOR;
      ctx.fillRect(seg.x, seg.y, ENEMY_CELL, ENEMY_CELL);
      // Draw segment divider
      if (i > 0) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(seg.x + 1, seg.y + 1, ENEMY_CELL - 2, ENEMY_CELL - 2);
        ctx.fillStyle = i === 0 ? WORM_HEAD_COLOR : WORM_BODY_COLOR;
        ctx.fillRect(seg.x + 2, seg.y + 2, ENEMY_CELL - 4, ENEMY_CELL - 4);
      }
    }
  }
}
