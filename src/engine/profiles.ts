/**
 * Engine profiles — Stockfish parameter presets.
 */

import type { EngineProfile } from '../state/contracts';

export const CASUAL: EngineProfile = {
  name: 'Casual',
  skillLevel: 5,
  depth: 8,
  movetime: 1000,
  addVariety: true,
};

export const SERIOUS: EngineProfile = {
  name: 'Serious',
  skillLevel: 15,
  depth: 15,
  movetime: 3000,
  addVariety: false,
};

export const PROFILES = {
  CASUAL,
  SERIOUS,
} as const;
