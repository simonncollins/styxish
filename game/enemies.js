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
const ENEMY_FIELD_TOP    = 36;  // = BORDER_INSET + HUD_HEIGHT (matches engine.js)
const ENEMY_FIELD_RIGHT  = 800 - 8;   // CANVAS_W - BORDER_INSET
const ENEMY_FIELD_BOTTOM = 580 - 8;   // CANVAS_H - BORDER_INSET

const STYX_SPEED = 48;   // pixels per second (base speed at level 1)
const STYX_SPEED_SCALE = 1.15; // speed multiplier per level
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

// Styx line segment half-length in pixels (total span = 2 * STYX_ARM_LEN = ~56px)
const STYX_ARM_LEN = 28;
// Speed of the Styx mass in pixels/second (base, level 1)
const STYX_BASE_SPEED = 80;
// Number of line segments per Styx
const STYX_NUM_LINES = 5;

function createStyx(claimedCells) {
  const pos = randomInteriorPos(claimedCells);
  const angle = Math.random() * Math.PI * 2;
  const speed = STYX_BASE_SPEED;

  // Velocity vector at the given angle
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  // Build N line segments, each with an independent angle and rotationRate
  const lines = [];
  for (let i = 0; i < STYX_NUM_LINES; i++) {
    lines.push({
      angle: (Math.random() * Math.PI * 2),
      rotationRate: (0.8 + Math.random() * 1.2) * (Math.random() < 0.5 ? 1 : -1),
    });
  }

  return {
    // Central mass position (continuous, not grid-snapped)
    cx: pos.x + ENEMY_CELL / 2,
    cy: pos.y + ENEMY_CELL / 2,
    vx,
    vy,
    lines,
  };
}

/* ---- Module state -------------------------------------------------------- */
const styxEnemies = [];

function initStyxEnemies(level, claimedCells) {
  styxEnemies.length = 0;
  const count = level >= 3 ? Math.min(level - 1, 3) : 1;
  for (let i = 0; i < count; i++) {
    styxEnemies.push(createStyx(claimedCells));
  }
}

/**
 * Apply a rotational impulse to each line segment when the mass bounces.
 * @param {object} styx - Styx object
 * @param {boolean} horizontal - true if bounced off left/right wall (vx flipped)
 */
function applyBounceImpulse(styx, horizontal) {
  const delta = (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1);
  for (const line of styx.lines) {
    // Add impulse to the rotation rate — creates the signature post-bounce swirl change
    line.rotationRate += delta * (horizontal ? 1 : -1);
    // Clamp to a reasonable range to avoid infinitely fast spinning
    const maxRate = 4.0;
    if (Math.abs(line.rotationRate) > maxRate) {
      line.rotationRate = Math.sign(line.rotationRate) * maxRate;
    }
  }
}

/**
 * Line-segment intersection test.
 * Returns true if segment AB intersects segment CD.
 */
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax; const d1y = by - ay;
  const d2x = dx - cx; const d2y = dy - cy;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false; // parallel
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
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
function updateStyxEnemies(dt, claimedCells, currentLine, player, onDeath, level = 1) {
  // Interior bounds for the Styx mass centre (keep arm-length away from walls)
  const margin = STYX_ARM_LEN + 4;
  const minX = ENEMY_FIELD_LEFT   + margin;
  const maxX = ENEMY_FIELD_RIGHT  - margin;
  const minY = ENEMY_FIELD_TOP    + margin;
  const maxY = ENEMY_FIELD_BOTTOM - margin;

  const speedScale = Math.pow(STYX_SPEED_SCALE, level - 1);

  for (const styx of styxEnemies) {
    // Advance each line's rotation
    for (const line of styx.lines) {
      line.angle += line.rotationRate * dt;
    }

    // Move the central mass
    styx.cx += styx.vx * speedScale * dt;
    styx.cy += styx.vy * speedScale * dt;

    // Bounce off left/right walls
    if (styx.cx < minX) {
      styx.cx = minX;
      styx.vx = Math.abs(styx.vx);
      applyBounceImpulse(styx, true);
    } else if (styx.cx > maxX) {
      styx.cx = maxX;
      styx.vx = -Math.abs(styx.vx);
      applyBounceImpulse(styx, true);
    }

    // Bounce off top/bottom walls
    if (styx.cy < minY) {
      styx.cy = minY;
      styx.vy = Math.abs(styx.vy);
      applyBounceImpulse(styx, false);
    } else if (styx.cy > maxY) {
      styx.cy = maxY;
      styx.vy = -Math.abs(styx.vy);
      applyBounceImpulse(styx, false);
    }

    // Collision: check each Styx arm against each segment of the draw line
    if (currentLine.length >= 2) {
      let hit = false;
      for (const line of styx.lines) {
        const ax = styx.cx + Math.cos(line.angle) * STYX_ARM_LEN;
        const ay = styx.cy + Math.sin(line.angle) * STYX_ARM_LEN;
        const bx = styx.cx - Math.cos(line.angle) * STYX_ARM_LEN;
        const by = styx.cy - Math.sin(line.angle) * STYX_ARM_LEN;
        for (let i = 0; i < currentLine.length - 1 && !hit; i++) {
          const p = currentLine[i];
          const q = currentLine[i + 1];
          if (segmentsIntersect(ax, ay, bx, by, p.x, p.y, q.x, q.y)) {
            hit = true;
          }
        }
        if (hit) break;
      }
      if (hit) onDeath();
    }
  }
}

/**
 * Render all Styx enemies as animated multi-line swirl shapes.
 * @param {CanvasRenderingContext2D} ctx
 */
function renderStyxEnemies(ctx) {
  ctx.save();
  ctx.lineWidth = 2;
  for (const styx of styxEnemies) {
    for (let i = 0; i < styx.lines.length; i++) {
      const line = styx.lines[i];
      // Alternate between CGA cyan and white for visual variety
      ctx.strokeStyle = i % 2 === 0 ? '#00FFFF' : '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(
        styx.cx + Math.cos(line.angle) * STYX_ARM_LEN,
        styx.cy + Math.sin(line.angle) * STYX_ARM_LEN,
      );
      ctx.lineTo(
        styx.cx - Math.cos(line.angle) * STYX_ARM_LEN,
        styx.cy - Math.sin(line.angle) * STYX_ARM_LEN,
      );
      ctx.stroke();
    }
  }
  ctx.restore();
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
  const count = Math.min(level, 3);
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
      if (typeof sfxFuseIgnition === 'function') sfxFuseIgnition();
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
