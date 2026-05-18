/**
 * Debug-only: render the current glasses frame (576×288) into a canvas on the
 * companion page so it can be screenshotted from real hardware where there is no
 * simulator screenshot API.
 *
 * The board is pixel-exact (same buffer encoded for the glasses). The text HUD is
 * an approximation — the glasses firmware renders the text container with its own
 * font, which cannot be reproduced here — but it is positioned in the real text
 * container box so layout/placement issues are faithful.
 */

import type { GameState } from '../state/contracts';
import type { ChessService } from '../chess/chessservice';
import { BoardRenderer } from '../render/boardimage';
import { getBoardLayout, BRAND_HEIGHT } from '../render/composer';
import { getCombinedDisplayText, getCapturedDisplay } from '../state/selectors';
import { DISPLAY_WIDTH } from '../state/constants';

const DISPLAY_HEIGHT = 288;
const TEXT_Y = 8; // mirrors composer.ts buildContainers (gameplay layout)
const SCALE = 2; // upscale so phone screenshots are legible
const ON = [120, 255, 140] as const; // glasses green
const OFF = [0, 0, 0] as const;

export interface BoardSnapshotDeps {
  getState: () => GameState;
  chess: ChessService;
}

function drawText(ctx: CanvasRenderingContext2D, state: GameState, layout: { textWidth: number }): void {
  const text = getCombinedDisplayText(state);
  const lines = text.split('\n');
  ctx.fillStyle = `rgb(${ON[0]},${ON[1]},${ON[2]})`;
  const fontPx = 16 * SCALE;
  ctx.font = `${fontPx}px "DM Mono", ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'top';
  const lineH = Math.round(fontPx * 1.25);
  let y = TEXT_Y * SCALE;
  for (const line of lines) {
    ctx.fillText(line, 4 * SCALE, y, layout.textWidth * SCALE - 8 * SCALE);
    y += lineH;
  }
}

function buildFrame(state: GameState, chess: ChessService): HTMLCanvasElement {
  const layout = getBoardLayout(state);
  const renderer = new BoardRenderer({ largeGrid: state.boardSize === 'large' });
  const { pixels, width, height } = renderer.snapshotPixels(state, chess);

  const canvas = document.createElement('canvas');
  canvas.width = DISPLAY_WIDTH * SCALE;
  canvas.height = DISPLAY_HEIGHT * SCALE;
  const ctx = canvas.getContext('2d')!;

  // Black background.
  ctx.fillStyle = `rgb(${OFF[0]},${OFF[1]},${OFF[2]})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Pixel-exact board at its real container position. Build a 1× ImageData for the
  // board region, then blit scaled via an offscreen canvas to keep pixels crisp.
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = width;
  boardCanvas.height = height;
  const bctx = boardCanvas.getContext('2d')!;
  const img = bctx.createImageData(width, height);
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    const lit = pixels[i] === 1;
    img.data[o] = lit ? ON[0] : OFF[0];
    img.data[o + 1] = lit ? ON[1] : OFF[1];
    img.data[o + 2] = lit ? ON[2] : OFF[2];
    img.data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    boardCanvas,
    layout.boardX * SCALE,
    layout.boardTopY * SCALE,
    width * SCALE,
    height * SCALE,
  );

  drawText(ctx, state, layout);

  // Captured-pieces strip directly above the board — parity with the brand container,
  // which now renders piece silhouettes here (Black's losses on top, White's below).
  // This debug view approximates the silhouettes with FEN letters.
  const cap = getCapturedDisplay(state);
  const stripY = layout.boardTopY - BRAND_HEIGHT;
  const xb = layout.boardX * SCALE;
  ctx.strokeStyle = `rgba(${ON[0]},${ON[1]},${ON[2]},0.4)`;
  ctx.strokeRect(xb, stripY * SCALE, width * SCALE, BRAND_HEIGHT * SCALE);
  ctx.fillStyle = `rgb(${ON[0]},${ON[1]},${ON[2]})`;
  ctx.font = `${13 * SCALE}px "DM Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  if (!cap.top && !cap.bottom) {
    ctx.fillText('CHESS', xb + 4 * SCALE, (stripY + 12) * SCALE, width * SCALE);
  } else {
    ctx.fillText(cap.top, xb + 4 * SCALE, (stripY + 2) * SCALE, width * SCALE);
    ctx.fillText(cap.bottom, xb + 4 * SCALE, (stripY + 21) * SCALE, width * SCALE);
  }
  return canvas;
}

export function initBoardSnapshot(deps: BoardSnapshotDeps): void {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('board-snapshot-btn') as HTMLButtonElement | null;
  const out = document.getElementById('board-snapshot-output') as HTMLImageElement | null;
  const fsBtn = document.getElementById('board-snapshot-download') as HTMLButtonElement | null;
  const statusEl = document.getElementById('board-snapshot-status');
  const capsEl = document.getElementById('board-snapshot-caps');
  if (!btn || !out) return;

  let currentObjUrl: string | null = null;

  function setStatus(msg: string): void {
    if (statusEl) statusEl.textContent = msg;
  }

  btn.addEventListener('click', () => {
    try {
      const state = deps.getState();
      const canvas = buildFrame(state, deps.chess);
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus('Could not encode the image — see console.');
          return;
        }
        if (currentObjUrl) URL.revokeObjectURL(currentObjUrl);
        currentObjUrl = URL.createObjectURL(blob);
        out.src = currentObjUrl;
        out.hidden = false;
        if (fsBtn) fsBtn.hidden = false;
        if (capsEl) {
          capsEl.textContent = `turn=${state.turn} fen=${state.fen}`;
        }
        setStatus('Captured: Tap View fullscreen, then screenshot.');
      }, 'image/png');
    } catch (err) {
      console.error('[board-snapshot] failed', err);
      btn.textContent = 'Snapshot failed — see console';
    }
  });

  // The Even Hub Android WebView runs in an insecure context, so clipboard/Web-Share
  // image APIs do not exist. The only universal path is a device screenshot. Present the
  // frame as a tap-to-dismiss fullscreen overlay (no new tab) so the screenshot is clean.
  fsBtn?.addEventListener('click', () => {
    if (!currentObjUrl) return;
    const overlay = document.createElement('div');
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'background:#000',
      'display:flex', 'align-items:center', 'justify-content:center', 'cursor:zoom-out',
    ].join(';'));
    const big = document.createElement('img');
    big.src = currentObjUrl;
    big.setAttribute('style', 'max-width:100vw;max-height:100vh;image-rendering:pixelated;');
    const hint = document.createElement('div');
    hint.textContent = 'Take a screenshot, then tap to close';
    hint.setAttribute('style', [
      'position:fixed', 'bottom:12px', 'left:0', 'right:0', 'text-align:center',
      'color:#7B7B7B', 'font:12px ui-monospace,monospace', 'pointer-events:none',
    ].join(';'));
    overlay.appendChild(big);
    overlay.appendChild(hint);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  });
}
