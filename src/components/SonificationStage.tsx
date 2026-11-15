import React, { useEffect, useRef, useState } from 'react';
import {
  C_MAJOR_PENTATONIC,
  GRID_COLS,
  GRID_ROWS,
  SonificationGrid,
  analyzeImageGrid,
} from '../utils/sonification';

interface SonificationStageProps {
  imageSrc: string;
  imageLabel: string;
  grid: SonificationGrid | null;
  currentCol: number;
  isPlaying: boolean;
  highContrast: boolean;
  showGridOverlay: boolean;
  onGridAnalyzed: (grid: SonificationGrid) => void;
  onSelectColumn: (col: number) => void;
  onImageError?: (message: string) => void;
}

/**
 * Programmatic fallback thermal Earth canvas if an image fails to decode.
 * Ensures the Zero-Broken-Image policy is always satisfied.
 */
function drawFallbackEarthVisualization(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#09152b');
  bg.addColorStop(0.5, '#0c274d');
  bg.addColorStop(1, '#071022');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Cool polar & mid-latitude ocean currents on the left
  const coolPlume = ctx.createRadialGradient(
    width * 0.25,
    height * 0.45,
    width * 0.04,
    width * 0.28,
    height * 0.45,
    width * 0.35,
  );
  coolPlume.addColorStop(0, 'rgba(56, 189, 248, 0.85)');
  coolPlume.addColorStop(0.5, 'rgba(37, 99, 235, 0.45)');
  coolPlume.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = coolPlume;
  ctx.fillRect(0, 0, width, height);

  // Warm equatorial thermal plume on the right
  const warmPlume = ctx.createRadialGradient(
    width * 0.75,
    height * 0.52,
    width * 0.03,
    width * 0.72,
    height * 0.52,
    width * 0.32,
  );
  warmPlume.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
  warmPlume.addColorStop(0.45, 'rgba(239, 68, 68, 0.72)');
  warmPlume.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = warmPlume;
  ctx.fillRect(0, 0, width, height);
}

export const SonificationStage: React.FC<SonificationStageProps> = ({
  imageSrc,
  imageLabel,
  grid,
  currentCol,
  isPlaying,
  highContrast,
  showGridOverlay,
  onGridAnalyzed,
  onSelectColumn,
  onImageError,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);

  // Load and analyze the active image onto an offscreen 320x160 sampling canvas
  useEffect(() => {
    let cancelled = false;
    setImageReady(false);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (cancelled) return;
      loadedImageRef.current = img;

      const sampleWidth = 320;
      const sampleHeight = 180;
      const offscreen = document.createElement('canvas');
      offscreen.width = sampleWidth;
      offscreen.height = sampleHeight;
      const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

      if (offCtx) {
        offCtx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
        const imageData = offCtx.getImageData(0, 0, sampleWidth, sampleHeight);
        const analyzed = analyzeImageGrid(
          imageData.data,
          sampleWidth,
          sampleHeight,
          GRID_COLS,
          GRID_ROWS,
        );
        onGridAnalyzed(analyzed);
      }
      setImageReady(true);
    };

    img.onerror = () => {
      if (cancelled) return;
      loadedImageRef.current = null;
      const sampleWidth = 320;
      const sampleHeight = 180;
      const offscreen = document.createElement('canvas');
      offscreen.width = sampleWidth;
      offscreen.height = sampleHeight;
      const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

      if (offCtx) {
        drawFallbackEarthVisualization(offCtx, sampleWidth, sampleHeight);
        const imageData = offCtx.getImageData(0, 0, sampleWidth, sampleHeight);
        const analyzed = analyzeImageGrid(
          imageData.data,
          sampleWidth,
          sampleHeight,
          GRID_COLS,
          GRID_ROWS,
        );
        onGridAnalyzed(analyzed);
      }
      setImageReady(true);
      onImageError?.('Could not decode selected file; rendered fallback Earth thermal map.');
    };

    img.src = imageSrc;

    return () => {
      cancelled = true;
    };
  }, [imageSrc, onGridAnalyzed, onImageError]);

  // Paint visualization image, 16x8 grid overlay, and highlighted vertical playhead bar
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const colWidth = width / GRID_COLS;
    const rowHeight = height / GRID_ROWS;

    ctx.clearRect(0, 0, width, height);

    if (loadedImageRef.current && imageReady) {
      ctx.drawImage(loadedImageRef.current, 0, 0, width, height);
    } else {
      drawFallbackEarthVisualization(ctx, width, height);
    }

    // Subtle dark scrim when grid overlay is enabled for clearer cell boundaries
    if (showGridOverlay) {
      ctx.save();
      ctx.strokeStyle = highContrast
        ? 'rgba(255, 255, 255, 0.55)'
        : 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = highContrast ? 1.5 : 1;

      for (let c = 1; c < GRID_COLS; c++) {
        const x = Math.round(c * colWidth) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let r = 1; r < GRID_ROWS; r++) {
        const y = Math.round(r * rowHeight) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw active column playhead vertical bar and cell timbre highlights
    const activeX = currentCol * colWidth;
    ctx.save();

    // Dim non-active columns slightly while playing so the active vertical bar stands out
    if (isPlaying) {
      ctx.fillStyle = highContrast ? 'rgba(0, 0, 0, 0.35)' : 'rgba(7, 9, 14, 0.28)';
      if (activeX > 0) {
        ctx.fillRect(0, 0, activeX, height);
      }
      if (activeX + colWidth < width) {
        ctx.fillRect(activeX + colWidth, 0, width - (activeX + colWidth), height);
      }
    }

    // Highlighted vertical bar over the column being played
    ctx.fillStyle = highContrast
      ? 'rgba(255, 255, 0, 0.22)'
      : 'rgba(34, 211, 238, 0.18)';
    ctx.fillRect(activeX, 0, colWidth, height);

    // Highlight audible cells inside the active column
    if (grid && grid.cells[currentCol]) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid.cells[currentCol][r];
        if (cell && cell.brightness >= 0.08) {
          const cellY = r * rowHeight;
          const isWarm = cell.waveform === 'triangle';
          ctx.strokeStyle = highContrast
            ? isWarm
              ? '#FF9900'
              : '#00FFFF'
            : isWarm
              ? 'rgba(245, 158, 11, 0.92)'
              : 'rgba(34, 211, 238, 0.92)';
          ctx.lineWidth = highContrast ? 3 : 2;
          ctx.strokeRect(
            activeX + 3,
            cellY + 3,
            Math.max(4, colWidth - 6),
            Math.max(4, rowHeight - 6),
          );
        }
      }
    }

    // Outer border of the active vertical playhead bar
    ctx.strokeStyle = highContrast ? '#FFFF00' : '#22D3EE';
    ctx.lineWidth = highContrast ? 4 : 3;
    ctx.strokeRect(activeX + 1.5, 1.5, colWidth - 3, height - 3);
    ctx.restore();
  }, [currentCol, grid, highContrast, imageReady, isPlaying, showGridOverlay]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const col = Math.min(
      GRID_COLS - 1,
      Math.max(0, Math.floor((relX / rect.width) * GRID_COLS)),
    );
    onSelectColumn(col);
  };

  return (
    <div className="w-full">
      {/* Row 1: Pitch Axis aligned exclusively with the 8 rows of the canvas */}
      <div className="flex items-stretch gap-2">
        <div
          aria-hidden="true"
          className="hidden sm:grid grid-rows-8 items-center w-6 shrink-0 text-[11px] font-mono-tabular text-right select-none"
          style={{ color: 'var(--text-secondary)' }}
        >
          {C_MAJOR_PENTATONIC.map((item) => (
            <span key={item.note} className="leading-none">
              {item.note}
            </span>
          ))}
        </div>

        <div
          className="flex-1 min-w-0 relative overflow-hidden rounded-lg"
          style={{
            border: `${highContrast ? '2px' : '1px'} solid var(--border-hairline)`,
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            data-testid="sonification-canvas"
            onClick={handleCanvasClick}
            aria-label={`Sonification visualization canvas for ${imageLabel}. Currently highlighting column ${currentCol + 1} of ${GRID_COLS}.`}
            className="block w-full h-auto aspect-video cursor-crosshair"
          />
        </div>
      </div>

      {/* Row 2: Interactive 16-column jump selector aligned underneath the canvas */}
      <div className="sm:pl-8 mt-2">
        <div
          role="group"
          aria-label="Jump to grid column 1 through 16"
          className="grid grid-cols-16 gap-0.5 sm:gap-1"
        >
          {Array.from({ length: GRID_COLS }, (_, idx) => {
            const active = idx === currentCol;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectColumn(idx)}
                aria-label={`Jump playhead to column ${idx + 1} of ${GRID_COLS}`}
                aria-current={active ? 'step' : undefined}
                className="min-h-[34px] px-0 rounded text-[10px] sm:text-[11px] font-mono-tabular font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: active
                    ? 'var(--accent-primary)'
                    : 'var(--bg-surface)',
                  color: active
                    ? 'var(--accent-primary-text)'
                    : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-hairline)'}`,
                }}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
