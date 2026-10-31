/**
 * Unit tests for the bullet clock display format.
 */

import { describe, it, expect } from 'vitest';
import { formatTime } from '../../src/bullet/clock';

describe('formatTime', () => {
  it('formats zero as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds correctly', () => {
    expect(formatTime(5000)).toBe('0:05');
    expect(formatTime(30000)).toBe('0:30');
    expect(formatTime(59000)).toBe('0:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(60000)).toBe('1:00');
    expect(formatTime(90000)).toBe('1:30');
    expect(formatTime(125000)).toBe('2:05');
  });

  it('formats large times', () => {
    expect(formatTime(300000)).toBe('5:00'); // 5 minutes
    expect(formatTime(600000)).toBe('10:00'); // 10 minutes
  });

  it('pads single-digit seconds with zero', () => {
    expect(formatTime(61000)).toBe('1:01');
    expect(formatTime(65000)).toBe('1:05');
    expect(formatTime(69000)).toBe('1:09');
  });

  it('handles sub-second precision (floors)', () => {
    expect(formatTime(1500)).toBe('0:01'); // 1.5 seconds -> 1 second
    expect(formatTime(999)).toBe('0:00'); // 0.999 seconds -> 0 seconds
  });
});
