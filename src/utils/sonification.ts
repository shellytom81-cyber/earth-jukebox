/**
 * Pure Earth-observation image analysis and sonification math for EarthEcho.
 * Decoupled from DOM and Web Audio API so every calculation can be unit-tested.
 */

export const GRID_COLS = 16;
export const GRID_ROWS = 8;

export type NoteWaveform = 'sine' | 'triangle';

export interface PentatonicNote {
  note: string;
  freq: number;
}

/**
 * C major pentatonic scale mapped top-to-bottom across 8 rows.
 * Row 0 (top of image) = highest pitch (E5).
 * Row 7 (bottom of image) = lowest pitch (C4).
 */
export const C_MAJOR_PENTATONIC: readonly PentatonicNote[] = [
  { note: 'E5', freq: 659.25 },
  { note: 'D5', freq: 587.33 },
  { note: 'C5', freq: 523.25 },
  { note: 'A4', freq: 440.0 },
  { note: 'G4', freq: 392.0 },
  { note: 'E4', freq: 329.63 },
  { note: 'D4', freq: 293.66 },
  { note: 'C4', freq: 261.63 },
] as const;

export interface GridCell {
  col: number;
  row: number;
  /** Normalized perceptual luminance from 0 (black) to 1 (white). */
  brightness: number;
  /** Warmth index (Red minus Blue normalized) from -1 (cool blue) to +1 (warm red). */
  warmth: number;
  /** Soft sine for cool cells (warmth <= 0), brighter triangle for warm cells (warmth > 0). */
  waveform: NoteWaveform;
  frequency: number;
  noteName: string;
  avgR: number;
  avgG: number;
  avgB: number;
}

export interface SonificationGrid {
  cols: number;
  rows: number;
  /** Column-major matrix: cells[col][row] */
  cells: GridCell[][];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Splits an RGBA pixel buffer into a 16-column x 8-row grid and computes
 * average brightness and warmth (red minus blue) for each cell.
 */
export function analyzeImageGrid(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
  cols: number = GRID_COLS,
  rows: number = GRID_ROWS,
): SonificationGrid {
  if (width <= 0 || height <= 0 || cols <= 0 || rows <= 0) {
    throw new Error('Image and grid dimensions must be positive.');
  }

  const cells: GridCell[][] = [];

  for (let col = 0; col < cols; col++) {
    const colCells: GridCell[] = [];
    const xStart = Math.floor((col * width) / cols);
    const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) * width) / cols));

    for (let row = 0; row < rows; row++) {
      const yStart = Math.floor((row * height) / rows);
      const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) * height) / rows));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * width;
        for (let x = xStart; x < xEnd; x++) {
          const idx = (rowOffset + x) * 4;
          sumR += pixels[idx] ?? 0;
          sumG += pixels[idx + 1] ?? 0;
          sumB += pixels[idx + 2] ?? 0;
          count++;
        }
      }

      const safeCount = Math.max(1, count);
      const avgR = sumR / safeCount;
      const avgG = sumG / safeCount;
      const avgB = sumB / safeCount;

      // Perceptual luminance (ITU-R BT.601) normalized 0..1
      const brightness = clamp((0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255, 0, 1);

      // Warmth defined as Red minus Blue normalized (-1..+1)
      const warmth = clamp((avgR - avgB) / 255, -1, 1);

      const waveform: NoteWaveform = warmth > 0 ? 'triangle' : 'sine';
      const noteInfo = C_MAJOR_PENTATONIC[row % C_MAJOR_PENTATONIC.length];

      colCells.push({
        col,
        row,
        brightness,
        warmth,
        waveform,
        frequency: noteInfo.freq,
        noteName: noteInfo.note,
        avgR,
        avgG,
        avgB,
      });
    }

    cells.push(colCells);
  }

  return { cols, rows, cells };
}

/**
 * Computes stereo pan from -1.0 (full left) to +1.0 (full right) across columns.
 */
export function computeStereoPan(col: number, totalCols: number = GRID_COLS): number {
  if (totalCols <= 1) return 0;
  const clampedCol = clamp(col, 0, totalCols - 1);
  return (clampedCol / (totalCols - 1)) * 2 - 1;
}

/**
 * Converts cell brightness and master volume into a safe per-oscillator gain,
 * scaling down gently when multiple notes sound simultaneously to avoid clipping.
 */
export function computeCellGain(
  brightness: number,
  masterVolume: number,
  activeNoteCount: number,
): number {
  const b = clamp(brightness, 0, 1);
  const vol = clamp(masterVolume, 0, 1);
  if (b < 0.03 || vol <= 0) return 0;

  const polyphonyDivisor = Math.max(2.2, Math.sqrt(Math.max(1, activeNoteCount)) * 1.35);
  const rawGain = (Math.pow(b, 1.25) * vol) / polyphonyDivisor;
  return clamp(rawGain, 0, 0.72);
}

export function formatPanLabel(pan: number): string {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct < 8) return 'Center';
  return pan < 0 ? `${pct}% Left` : `${pct}% Right`;
}

export interface ColumnSummary {
  colNumber: number;
  totalCols: number;
  sideLabel: 'Left' | 'Center-Left' | 'Center-Right' | 'Right';
  panLabel: string;
  avgBrightness: number;
  avgWarmth: number;
  dominantWaveform: NoteWaveform | 'mixed';
  activeNotes: string[];
  description: string;
}

/**
 * Generates an accessible plain-language description of what is currently heard
 * in a single column of the sonification grid.
 */
export function describeColumnSonification(
  grid: SonificationGrid,
  colIndex: number,
): ColumnSummary {
  const safeCol = clamp(colIndex, 0, grid.cols - 1);
  const column = grid.cells[safeCol];
  const pan = computeStereoPan(safeCol, grid.cols);
  const panLabel = formatPanLabel(pan);

  const sideLabel: ColumnSummary['sideLabel'] =
    safeCol < grid.cols * 0.25
      ? 'Left'
      : safeCol < grid.cols * 0.5
        ? 'Center-Left'
        : safeCol < grid.cols * 0.75
          ? 'Center-Right'
          : 'Right';

  const audible = column.filter((c) => c.brightness >= 0.08);
  const sample = audible.length > 0 ? audible : column;

  // Weight warmth and waveform dominance by cell brightness so prominent features
  // define what the listener actually hears rather than dim background pixels.
  let totalWeight = 0;
  let weightedWarmth = 0;
  let warmEnergy = 0;
  let coolEnergy = 0;

  for (const cell of sample) {
    const w = Math.max(0.01, Math.pow(cell.brightness, 1.25));
    totalWeight += w;
    weightedWarmth += cell.warmth * w;
    if (cell.waveform === 'triangle') warmEnergy += w;
    else coolEnergy += w;
  }

  const avgBrightness =
    sample.reduce((sum, cell) => sum + cell.brightness, 0) / sample.length;
  const peakBrightness = Math.max(...sample.map((c) => c.brightness));
  const perceivedBrightness = avgBrightness * 0.45 + peakBrightness * 0.55;
  const avgWarmth = weightedWarmth / Math.max(0.01, totalWeight);

  let dominantWaveform: ColumnSummary['dominantWaveform'] = 'mixed';
  if (warmEnergy > coolEnergy * 1.35) dominantWaveform = 'triangle';
  else if (coolEnergy > warmEnergy * 1.35) dominantWaveform = 'sine';

  // Pick top 3 brightest audible cells for note listing
  const prominent = [...audible]
    .sort((a, b) => b.brightness - a.brightness)
    .slice(0, 3)
    .sort((a, b) => a.row - b.row);

  const activeNotes = prominent.map((c) => c.noteName);

  // Vertical band localization
  const bands = new Set<string>();
  for (const c of prominent) {
    if (c.row <= 2) bands.add('upper');
    else if (c.row <= 4) bands.add('middle');
    else bands.add('lower');
  }
  const bandList = Array.from(bands);
  const bandPhrase =
    bandList.length === 0
      ? 'all bands'
      : bandList.length === 1
        ? `the ${bandList[0]} band`
        : `${bandList.slice(0, -1).join(', ')} and ${bandList[bandList.length - 1]} bands`;

  const brightnessWord =
    perceivedBrightness >= 0.52 ? 'Bright' : perceivedBrightness >= 0.24 ? 'Moderate' : 'Dim';
  const warmthWord =
    avgWarmth > 0.04 ? 'warm' : avgWarmth < -0.04 ? 'cool' : 'neutral';

  const volumeOutcome =
    perceivedBrightness >= 0.52 ? 'louder' : perceivedBrightness >= 0.24 ? 'steady' : 'soft';

  const timbreOutcome =
    dominantWaveform === 'triangle'
      ? 'brighter triangle'
      : dominantWaveform === 'sine'
        ? 'soft sine'
        : 'blended sine and triangle';

  const sideDirection =
    sideLabel === 'Left' || sideLabel === 'Center-Left' ? 'on the left' : 'on the right';

  let description: string;
  if (audible.length === 0 || avgBrightness < 0.06) {
    description = `Column ${safeCol + 1} of ${grid.cols} (${sideLabel}): Dark regions ${sideDirection} remain quiet with minimal low-level sine resonance.`;
  } else {
    const notesSuffix = activeNotes.length > 0 ? ` (${activeNotes.join(', ')})` : '';
    description = `Column ${safeCol + 1} of ${grid.cols} (${sideLabel}): ${brightnessWord}, ${warmthWord} areas in ${bandPhrase} produce ${volumeOutcome}, ${timbreOutcome} notes${notesSuffix}.`;
  }

  return {
    colNumber: safeCol + 1,
    totalCols: grid.cols,
    sideLabel,
    panLabel,
    avgBrightness,
    avgWarmth,
    dominantWaveform,
    activeNotes,
    description,
  };
}

/**
 * Generates an initial whole-image acoustic overview before playback begins.
 */
export function describeOverallImage(grid: SonificationGrid): string {
  const half = Math.floor(grid.cols / 2);
  const leftCells = grid.cells.slice(0, half).flat();
  const rightCells = grid.cells.slice(half).flat();

  const summarizeHalf = (arr: GridCell[]) => {
    const safeLen = Math.max(1, arr.length);
    const avgBright = arr.reduce((sum, cell) => sum + cell.brightness, 0) / safeLen;
    let totalWeight = 0;
    let weightedWarmth = 0;
    for (const cell of arr) {
      const w = Math.max(0.01, Math.pow(cell.brightness, 1.25));
      totalWeight += w;
      weightedWarmth += cell.warmth * w;
    }
    const avgWarm = weightedWarmth / Math.max(0.01, totalWeight);
    const bWord = avgBright >= 0.45 ? 'bright' : avgBright >= 0.22 ? 'moderate' : 'dark';
    const wWord =
      avgWarm > 0.03 ? 'warm (triangle waves)' : avgWarm < -0.03 ? 'cool (sine waves)' : 'neutral';
    return `${bWord}, ${wWord}`;
  };

  return `Image mapped to a ${grid.cols}×${grid.rows} grid. Left side features ${summarizeHalf(leftCells)} regions; right side features ${summarizeHalf(rightCells)} regions. Press Play or Space to hear the left-to-right scan.`;
}
