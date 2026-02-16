/**
 * Engine profiles — Stockfish parameter presets.
 */

import type { EngineProfile, DifficultyLevel } from '../state/contracts';

export const EASY: EngineProfile = {
  name: 'Easy',
  skillLevel: 3,
  depth: 6,
  movetime: 600,
  addVariety: true,
};

export const CASUAL: EngineProfile = {
  name: 'Casual',
  skillLevel: 5,
  depth: 8,
  movetime: 1000,
  addVariety: false,
};

export const SERIOUS: EngineProfile = {
  name: 'Serious',
  skillLevel: 15,
  depth: 15,
  movetime: 3000,
  addVariety: false,
};

export const PROFILE_BY_DIFFICULTY: Record<DifficultyLevel, EngineProfile> = {
  easy: EASY,
  casual: CASUAL,
  serious: SERIOUS,
};
