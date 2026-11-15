/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Contrast,
  Grid3x3,
  Pause,
  Play,
  RotateCcw,
  Type,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import defaultEarthImage from './assets/images/nasa_earth_thermal_map_1794677858538.jpg';
import { SonificationStage } from './components/SonificationStage';
import { EarthAudioEngine } from './utils/audioEngine';
import {
  GRID_COLS,
  SonificationGrid,
  clamp,
  describeColumnSonification,
  describeOverallImage,
} from './utils/sonification';

const MIN_SPEED = 1;
const MAX_SPEED = 12;

export default function App() {
  const [imageSrc, setImageSrc] = useState<string>(defaultEarthImage);
  const [imageLabel, setImageLabel] = useState<string>(
    'Global Sea Surface Temperature & Cloud Anomaly',
  );
  const [isCustomImage, setIsCustomImage] = useState<boolean>(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);

  const [grid, setGrid] = useState<SonificationGrid | null>(null);
  const [currentCol, setCurrentCol] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);

  // Speed in columns per second (1..12) and Volume (0..100%)
  const [speed, setSpeed] = useState<number>(4);
  const [volumePct, setVolumePct] = useState<number>(75);

  // Accessibility states
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [largeText, setLargeText] = useState<boolean>(false);
  const [showGridOverlay, setShowGridOverlay] = useState<boolean>(true);

  const audioEngineRef = useRef<EarthAudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const getAudioEngine = useCallback(() => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new EarthAudioEngine();
    }
    return audioEngineRef.current;
  }, []);

  // Sync accessibility classes onto <html> so rem sizing and CSS theme variables cascade globally
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('high-contrast', highContrast);
    root.classList.toggle('large-text', largeText);
  }, [highContrast, largeText]);

  // Clean up audio engine and uploaded blob URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      audioEngineRef.current?.dispose();
    };
  }, []);

  // Update Web Audio master gain immediately when volume slider changes
  useEffect(() => {
    audioEngineRef.current?.setMasterVolume(volumePct / 100);
  }, [volumePct]);

  const playSingleColumn = useCallback(
    (colIndex: number, stepSpeed: number, volPct: number) => {
      if (!grid || !grid.cells[colIndex]) return;
      const engine = getAudioEngine();
      engine.playColumn(
        grid.cells[colIndex],
        colIndex,
        1 / stepSpeed,
        volPct / 100,
        grid.cols,
      );
    },
    [getAudioEngine, grid],
  );

  // Start or pause playback strictly from a user action (click or Space key)
  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      setIsPlaying(false);
      audioEngineRef.current?.stopAll();
      return;
    }

    const engine = getAudioEngine();
    await engine.ensureReady(volumePct / 100);
    setHasInteracted(true);
    setIsPlaying(true);
    playSingleColumn(currentCol, speed, volumePct);
  }, [currentCol, getAudioEngine, isPlaying, playSingleColumn, speed, volumePct]);

  // Left-to-right scanning loop synchronized with Web Audio playback
  useEffect(() => {
    if (!isPlaying || !grid) return;

    const intervalMs = Math.round(1000 / speed);
    const timerId = window.setInterval(() => {
      setCurrentCol((prev) => {
        const nextCol = (prev + 1) % grid.cols;
        playSingleColumn(nextCol, speed, volumePct);
        return nextCol;
      });
    }, intervalMs);

    return () => window.clearInterval(timerId);
  }, [grid, isPlaying, playSingleColumn, speed, volumePct]);

  // Global keyboard shortcuts: Space = Play/Pause, Arrow keys = Speed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';

      if (e.code === 'Space') {
        if (
          tag === 'BUTTON' ||
          tag === 'A' ||
          (tag === 'INPUT' && (target as HTMLInputElement).type === 'file')
        ) {
          return;
        }
        e.preventDefault();
        void togglePlayPause();
        return;
      }

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        if (tag === 'INPUT' && (target as HTMLInputElement).type === 'range') {
          return;
        }
        e.preventDefault();
        const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
        setSpeed((prev) => clamp(prev + delta, MIN_SPEED, MAX_SPEED));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause]);

  // Handle user-uploaded image files cleanly in memory (no backend)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setImageNotice('Please select a valid image file (PNG, JPG, WebP, or GIF).');
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;

    setIsPlaying(false);
    audioEngineRef.current?.stopAll();
    setCurrentCol(0);
    setImageSrc(nextUrl);
    setImageLabel(file.name.replace(/\.[^.]+$/, ''));
    setIsCustomImage(true);
    setImageNotice(null);
    e.target.value = '';
  };

  const handleResetDefault = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setIsPlaying(false);
    audioEngineRef.current?.stopAll();
    setCurrentCol(0);
    setImageSrc(defaultEarthImage);
    setImageLabel('Global Sea Surface Temperature & Cloud Anomaly');
    setIsCustomImage(false);
    setImageNotice(null);
  };

  const handleSelectColumn = useCallback(
    async (col: number) => {
      const clampedCol = clamp(col, 0, GRID_COLS - 1);
      setCurrentCol(clampedCol);

      // Direct click on a column is a user gesture, so we can safely audition that column
      const engine = getAudioEngine();
      await engine.ensureReady(volumePct / 100);
      setHasInteracted(true);
      playSingleColumn(clampedCol, speed, volumePct);
    },
    [getAudioEngine, playSingleColumn, speed, volumePct],
  );

  const handleGridAnalyzed = useCallback((analyzed: SonificationGrid) => {
    setGrid(analyzed);
  }, []);

  const handleImageError = useCallback((message: string) => {
    setImageNotice(message);
  }, []);

  const columnSummary = useMemo(() => {
    if (!grid) return null;
    return describeColumnSonification(grid, currentCol);
  }, [currentCol, grid]);

  const overallOverview = useMemo(() => {
    if (!grid) return 'Analyzing visualization grid...';
    return describeOverallImage(grid);
  }, [grid]);

  const liveDescriptionText =
    isPlaying || hasInteracted
      ? (columnSummary?.description ?? overallOverview)
      : overallOverview;

  const timbreLabel =
    columnSummary?.dominantWaveform === 'triangle'
      ? 'Triangle (Warm)'
      : columnSummary?.dominantWaveform === 'sine'
        ? 'Sine (Cool)'
        : 'Mixed (Sine + Triangle)';

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
      data-playing={isPlaying ? 'true' : 'false'}
      data-high-contrast={highContrast ? 'true' : 'false'}
      data-large-text={largeText ? 'true' : 'false'}
    >
      {/* Skip Link for Keyboard & Screen Reader Users */}
      <a
        href="#main-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-md focus:font-semibold"
        style={{
          backgroundColor: 'var(--accent-primary)',
          color: 'var(--accent-primary-text)',
        }}
      >
        Skip to EarthEcho controls
      </a>

      {/* Top Bar: Clean 3-Zone Layout */}
      <header
        className="w-full"
        style={{
          borderBottom: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4 sm:gap-8">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight whitespace-nowrap shrink-0">
              EarthEcho
            </h1>
          </div>

          <p
            className="hidden md:block text-sm truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            Earth Observation & Climate Sonification
          </p>

          <div
            className="flex items-center gap-2.5 shrink-0"
            role="group"
            aria-label="Display accessibility settings"
          >
            <button
              type="button"
              onClick={() => setHighContrast((prev) => !prev)}
              aria-pressed={highContrast}
              aria-label="Toggle high-contrast mode"
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              style={{
                backgroundColor: highContrast
                  ? 'var(--accent-primary)'
                  : 'var(--bg-surface-elevated)',
                color: highContrast
                  ? 'var(--accent-primary-text)'
                  : 'var(--text-primary)',
                border: `${highContrast ? '2px' : '1px'} solid ${
                  highContrast ? 'var(--accent-primary)' : 'var(--border-hairline)'
                }`,
              }}
            >
              <Contrast className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>High Contrast</span>
            </button>

            <button
              type="button"
              onClick={() => setLargeText((prev) => !prev)}
              aria-pressed={largeText}
              aria-label="Toggle large-text mode"
              className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              style={{
                backgroundColor: largeText
                  ? 'var(--accent-primary)'
                  : 'var(--bg-surface-elevated)',
                color: largeText
                  ? 'var(--accent-primary-text)'
                  : 'var(--text-primary)',
                border: `${highContrast ? '2px' : '1px'} solid ${
                  largeText ? 'var(--accent-primary)' : 'var(--border-hairline)'
                }`,
              }}
            >
              <Type className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Large Text</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Split Scientific Console */}
      <main
        id="main-workspace"
        className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-5"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7 items-start">
          {/* Left Stage: Image Visualization + 16x8 Grid & Playhead */}
          <section
            aria-labelledby="stage-heading"
            className="lg:col-span-8 flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="stage-heading"
                  className="text-base sm:text-lg font-semibold tracking-tight"
                >
                  Earth Visualization Stage
                </h2>
                <p
                  className="text-sm truncate"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {imageLabel}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    color: 'var(--text-primary)',
                    border: `${highContrast ? '2px' : '1px'} solid var(--border-strong)`,
                  }}
                >
                  <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Upload image</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGridOverlay((prev) => !prev)}
                  aria-pressed={showGridOverlay}
                  className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
                  }}
                >
                  <Grid3x3 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>16×8 Grid</span>
                </button>

                {isCustomImage && (
                  <button
                    type="button"
                    onClick={handleResetDefault}
                    className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
                    }}
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Default image</span>
                  </button>
                )}
              </div>
            </div>

            {imageNotice && (
              <p
                role="alert"
                className="px-3.5 py-2.5 rounded-lg text-sm"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: `1px solid var(--accent-warm)`,
                  color: 'var(--text-primary)',
                }}
              >
                {imageNotice}
              </p>
            )}

            <SonificationStage
              imageSrc={imageSrc}
              imageLabel={imageLabel}
              grid={grid}
              currentCol={currentCol}
              isPlaying={isPlaying}
              highContrast={highContrast}
              showGridOverlay={showGridOverlay}
              onGridAnalyzed={handleGridAnalyzed}
              onSelectColumn={(col) => void handleSelectColumn(col)}
              onImageError={handleImageError}
            />

            {/* Unboxed Metadata & Live Telemetry Strip */}
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm font-mono-tabular pt-1"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Current playhead telemetry"
            >
              <span>
                Column{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {String(currentCol + 1).padStart(2, '0')} / {GRID_COLS}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Stereo Pan{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {columnSummary?.panLabel ?? '100% Left'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Timbre{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {timbreLabel}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Notes{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {columnSummary && columnSummary.activeNotes.length > 0
                    ? columnSummary.activeNotes.join(', ')
                    : 'Quiet'}
                </strong>
              </span>
            </div>
          </section>

          {/* Right Column: Transport, Sliders & Accessible Live Audio Description */}
          <aside
            aria-label="Audio controls and live sonification description"
            className="lg:col-span-4 flex flex-col gap-4"
          >
            {/* Primary Controls Surface */}
            <section
              aria-labelledby="controls-heading"
              className="p-4 rounded-lg flex flex-col gap-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id="controls-heading" className="text-base font-semibold">
                  Sonification Controls
                </h2>
                <span
                  className="text-xs font-mono-tabular"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {isPlaying ? '● Playing' : '■ Paused'}
                </span>
              </div>

              {/* Primary Play / Pause Trigger (User-gesture audio unlock) */}
              <button
                type="button"
                onClick={() => void togglePlayPause()}
                aria-pressed={isPlaying}
                aria-label={isPlaying ? 'Pause sonification' : 'Play sonification'}
                className="w-full min-h-[48px] px-5 py-3 rounded-lg font-semibold text-base inline-flex items-center justify-center gap-2.5 cursor-pointer transition-opacity hover:opacity-95"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'var(--accent-primary-text)',
                }}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span>Play Sonification</span>
                  </>
                )}
              </button>

              {/* Speed Slider */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="speed-slider" className="text-sm font-medium">
                    Scan Speed
                  </label>
                  <span
                    className="text-sm font-mono-tabular font-semibold"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {speed} col/s
                  </span>
                </div>
                <input
                  id="speed-slider"
                  type="range"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={1}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  aria-label="Scan speed in columns per second"
                  aria-valuetext={`${speed} columns per second`}
                  className="jukebox-slider"
                />
                <div
                  className="flex justify-between text-xs font-mono-tabular"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>1 col/s (Slow)</span>
                  <span>12 col/s (Fast)</span>
                </div>
              </div>

              {/* Volume Slider */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="volume-slider"
                    className="text-sm font-medium inline-flex items-center gap-1.5"
                  >
                    {volumePct === 0 ? (
                      <VolumeX className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>Master Volume</span>
                  </label>
                  <span
                    className="text-sm font-mono-tabular font-semibold"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {volumePct}%
                  </span>
                </div>
                <input
                  id="volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volumePct}
                  onChange={(e) => setVolumePct(Number(e.target.value))}
                  aria-label="Master audio volume percentage"
                  aria-valuetext={`${volumePct} percent`}
                  className="jukebox-slider"
                />
              </div>
            </section>

            {/* Live Accessible Audio Description Panel */}
            <section
              aria-labelledby="live-desc-heading"
              className="p-4 rounded-lg flex flex-col gap-2.5"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
              }}
            >
              <h2 id="live-desc-heading" className="text-base font-semibold">
                What You Are Hearing
              </h2>

              <p
                aria-live="polite"
                aria-atomic="true"
                data-testid="live-audio-description"
                className="text-sm sm:text-base leading-relaxed"
                style={{ color: 'var(--text-primary)' }}
              >
                {liveDescriptionText}
              </p>

              <div
                className="pt-3 grid grid-cols-2 gap-4 text-xs sm:text-sm"
                style={{
                  borderTop: `1px solid var(--border-hairline)`,
                }}
              >
                <div>
                  <span
                    className="block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Brightness (Volume)
                  </span>
                  <span className="font-mono-tabular font-semibold text-base">
                    {columnSummary
                      ? `${Math.round(columnSummary.avgBrightness * 100)}%`
                      : '--'}
                  </span>
                </div>

                <div>
                  <span
                    className="block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Warmth (Red − Blue)
                  </span>
                  <span className="font-mono-tabular font-semibold text-base">
                    {columnSummary
                      ? `${columnSummary.avgWarmth >= 0 ? '+' : ''}${Math.round(columnSummary.avgWarmth * 100)}%`
                      : '--'}
                  </span>
                </div>
              </div>
            </section>

            {/* Audio Mapping & Keyboard Guide */}
            <section
              aria-labelledby="guide-heading"
              className="p-4 rounded-lg flex flex-col gap-2"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
              }}
            >
              <h2 id="guide-heading" className="text-base font-semibold">
                Audio Mapping & Shortcuts
              </h2>

              <dl
                className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                <dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Pitch
                </dt>
                <dd>Higher row = higher C major pentatonic note (C4–E5)</dd>

                <dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Volume
                </dt>
                <dd>Brighter pixels play louder tones</dd>

                <dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Timbre
                </dt>
                <dd>Cool = soft sine wave · Warm = brighter triangle wave</dd>

                <dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Stereo
                </dt>
                <dd>Sound pans left to right with the playhead</dd>

                <dt className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Keys
                </dt>
                <dd>Space = Play/Pause · Left/Right arrows = Speed</dd>
              </dl>
            </section>
          </aside>
        </div>
      </main>

      {/* Footer Credit */}
      <footer
        className="w-full py-3 mt-auto"
        style={{
          borderTop: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div
          className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span>Imagery: Global Earth Thermal Visualization</span>
          <span>EarthEcho · Accessible Earth Science Explorer</span>
        </div>
      </footer>
    </div>
  );
}
