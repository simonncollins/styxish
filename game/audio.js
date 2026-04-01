/**
 * audio.js — Procedural sound effects via Web Audio API (issue #24)
 *
 * All sounds are synthesized with oscillators/noise — zero audio file dependencies.
 * AudioContext is lazily created on the first user interaction (browser autoplay compliance).
 */

'use strict';

// ---------------------------------------------------------------------------
// AudioContext — created on first keypress/click, then reused
// ---------------------------------------------------------------------------

let _ctx = null;

/** Return the shared AudioContext, creating it on first call. */
function getAudioContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (Chrome autoplay policy)
  if (_ctx.state === 'suspended') {
    _ctx.resume();
  }
  return _ctx;
}

// Unlock AudioContext on first user interaction so later calls are instant.
['keydown', 'mousedown', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, () => getAudioContext(), { once: false, passive: true });
});

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Play a single oscillator tone.
 * @param {string} type   - OscillatorType ('square'|'sawtooth'|'sine'|'triangle')
 * @param {number} freq   - Start frequency in Hz
 * @param {number} endFreq - End frequency Hz (for frequency ramp; same as freq for constant)
 * @param {number} duration - Duration in seconds
 * @param {number} gain   - Peak gain (0–1)
 */
function playTone(type, freq, endFreq, duration, gain = 0.3) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), now + duration);
  }

  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

/**
 * Play a burst of white noise.
 * @param {number} duration - Duration in seconds
 * @param {number} gain     - Peak gain (0–1)
 */
function playNoise(duration, gain = 0.2) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const sampleRate = ctx.sampleRate;
  const bufferSize = Math.ceil(sampleRate * duration);

  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Low-pass filter to shape the crunch
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, now);
  filter.frequency.exponentialRampToValueAtTime(80, now + duration);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  source.start(now);
}

// ---------------------------------------------------------------------------
// Public sound effects
// ---------------------------------------------------------------------------

/**
 * Draw start — short rising boop (~100ms, square wave).
 * Fires when SPACEBAR activates draw mode.
 */
function sfxDrawStart() {
  playTone('square', 220, 440, 0.10, 0.25);
}

/**
 * Territory claim — descending sweep (~300ms, sawtooth).
 * Fires when flood-fill completes and territory is claimed.
 */
function sfxTerritoryClaim() {
  playTone('sawtooth', 880, 220, 0.30, 0.30);
}

/**
 * Fuse ignition — harsh buzz (~150ms, square wave, lower freq).
 * Fires when the Fuse enemy starts ticking (draw mode begins).
 */
function sfxFuseIgnition() {
  playTone('square', 110, 90, 0.15, 0.35);
}

/**
 * Death — crunch / descending noise (~400ms).
 * Fires when the player loses a life.
 */
function sfxDeath() {
  // Noise burst for the crunch
  playNoise(0.40, 0.40);
  // Descending tone underneath
  playTone('sawtooth', 300, 40, 0.40, 0.20);
}

/**
 * Level complete — short 3-note ascending fanfare (~600ms).
 * Fires when 80% territory threshold is reached.
 */
function sfxLevelComplete() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  // Note offsets: C5, E5, G5
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    gainNode.gain.setValueAtTime(0.001, now + i * 0.18);
    gainNode.gain.linearRampToValueAtTime(0.30, now + i * 0.18 + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.20);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.22);
  });
}
