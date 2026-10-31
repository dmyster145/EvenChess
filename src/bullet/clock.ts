/**
 * Bullet clock display. The clock itself (ticking, increments, flag fall) lives in the reducer's
 * TIMER_TICK and APPLY_INCREMENT handling.
 */

/** Format milliseconds as M:SS, rounding down to the whole second. */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
