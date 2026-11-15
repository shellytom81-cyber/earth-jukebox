import test from 'node:test';
import assert from 'node:assert/strict';
import {
  C_MAJOR_PENTATONIC,
  GRID_COLS,
  GRID_ROWS,
  analyzeImageGrid,
  computeCellGain,
  computeStereoPan,
  describeColumnSonification,
  describeOverallImage,
} from './sonification';

/** Helper to build a synthetic RGBA buffer of size width x height using a pixel callback. */
function makeImageBuffer(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const idx = (y * width + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

test('C major pentatonic scale decreases in pitch from top row (0) to bottom row (7)', () => {
  assert.equal(C_MAJOR_PENTATONIC.length, GRID_ROWS);
  for (let i = 0; i < C_MAJOR_PENTATONIC.length - 1; i++) {
    assert.ok(
      C_MAJOR_PENTATONIC[i].freq > C_MAJOR_PENTATONIC[i + 1].freq,
      `Row ${i} should be higher pitched than row ${i + 1}`,
    );
  }
  assert.equal(C_MAJOR_PENTATONIC[0].note, 'E5');
  assert.equal(C_MAJOR_PENTATONIC[7].note, 'C4');
});

test('computeStereoPan spans -1 (left) to +1 (right)', () => {
  assert.equal(computeStereoPan(0, 16), -1);
  assert.equal(computeStereoPan(15, 16), 1);
  const mid = computeStereoPan(7.5, 16);
  assert.ok(Math.abs(mid) < 1e-9);
});

test('analyzeImageGrid detects cool left sine vs bright warm right triangle cells', () => {
  const width = 32;
  const height = 16;
  // Left half: dim cool blue (R=20, G=40, B=140). Right half: bright warm orange-red (R=250, G=160, B=30).
  const pixels = makeImageBuffer(width, height, (x) =>
    x < width / 2 ? [20, 40, 140] : [250, 160, 30],
  );

  const grid = analyzeImageGrid(pixels, width, height, GRID_COLS, GRID_ROWS);
  assert.equal(grid.cols, 16);
  assert.equal(grid.rows, 8);

  const coolCell = grid.cells[2][3];
  assert.ok(coolCell.warmth < 0, 'Left side should have negative warmth (cool)');
  assert.equal(coolCell.waveform, 'sine');
  assert.ok(coolCell.brightness < 0.3);

  const warmCell = grid.cells[13][3];
  assert.ok(warmCell.warmth > 0.5, 'Right side should have strong positive warmth');
  assert.equal(warmCell.waveform, 'triangle');
  assert.ok(warmCell.brightness > 0.6);
});

test('computeCellGain scales with brightness and master volume and prevents clipping', () => {
  assert.equal(computeCellGain(0.01, 1.0, 4), 0);
  assert.equal(computeCellGain(0.9, 0, 4), 0);

  const dimGain = computeCellGain(0.25, 0.8, 4);
  const brightGain = computeCellGain(0.95, 0.8, 4);
  assert.ok(brightGain > dimGain);
  assert.ok(brightGain <= 0.72);
});

test('describeColumnSonification produces accurate human-readable audio description', () => {
  const width = 32;
  const height = 16;
  const pixels = makeImageBuffer(width, height, (x, y) => {
    if (x >= 24 && y < 6) return [255, 190, 40]; // bright warm top-right
    return [10, 20, 90]; // dim cool elsewhere
  });

  const grid = analyzeImageGrid(pixels, width, height);
  const rightSummary = describeColumnSonification(grid, 13);
  assert.equal(rightSummary.sideLabel, 'Right');
  assert.equal(rightSummary.dominantWaveform, 'triangle');
  assert.match(rightSummary.description, /Bright, warm/i);
  assert.match(rightSummary.description, /triangle/i);

  const overview = describeOverallImage(grid);
  assert.match(overview, /16×8/);
});
