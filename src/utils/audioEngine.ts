import {
  GRID_COLS,
  GridCell,
  computeCellGain,
  computeStereoPan,
} from './sonification';

/**
 * Self-contained Web Audio API synthesizer for EarthEcho.
 * AudioContext is created/resumed strictly inside a user interaction handler
 * to satisfy browser autoplay policies.
 */
export class EarthAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private activeOscillators: Set<OscillatorNode> = new Set();

  /**
   * Initializes or resumes the AudioContext. Must be called from a user click
   * or keyboard gesture.
   */
  public async ensureReady(initialVolume: number): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-16, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(initialVolume, this.ctx.currentTime);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  public setMasterVolume(volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    const clamped = Math.min(1, Math.max(0, volume));
    this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
  }

  /**
   * Sonifies a single vertical column of 8 cells:
   * - Pitch from row (C major pentatonic, higher row = higher pitch)
   * - Volume from brightness
   * - Waveform from warmth (cool = sine, warm = triangle)
   * - Stereo pan from horizontal column position (-1 left to +1 right)
   */
  public playColumn(
    columnCells: GridCell[],
    colIndex: number,
    stepDurationSec: number,
    masterVolume: number,
    totalCols: number = GRID_COLS,
  ): void {
    if (!this.ctx || !this.compressor || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const audibleCells = columnCells.filter((cell) => cell.brightness >= 0.04);
    if (audibleCells.length === 0) return;

    const panValue = computeStereoPan(colIndex, totalCols);
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(panValue, now);
    panner.connect(this.compressor);

    const noteDuration = Math.max(0.08, stepDurationSec * 0.92);
    const attack = Math.min(0.025, noteDuration * 0.2);

    for (const cell of audibleCells) {
      const gainAmount = computeCellGain(
        cell.brightness,
        masterVolume > 0 ? 1 : 0, // Master gain node scales overall volume
        audibleCells.length,
      );
      if (gainAmount <= 0.001) continue;

      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();

      osc.type = cell.waveform;
      osc.frequency.setValueAtTime(cell.frequency, now);

      // Smooth envelope avoids clicks when starting and stopping notes
      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.linearRampToValueAtTime(gainAmount, now + attack);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + noteDuration);

      osc.connect(noteGain);
      noteGain.connect(panner);

      this.activeOscillators.add(osc);
      osc.onended = () => {
        this.activeOscillators.delete(osc);
        osc.disconnect();
        noteGain.disconnect();
      };

      osc.start(now);
      osc.stop(now + noteDuration + 0.02);
    }
  }

  public stopAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const osc of this.activeOscillators) {
      try {
        osc.stop(now + 0.01);
      } catch {
        // Ignore already-stopped oscillator
      }
    }
    this.activeOscillators.clear();
  }

  public dispose(): void {
    this.stopAll();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.compressor = null;
    }
  }
}
