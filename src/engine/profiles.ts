/**
 * Engine profiles — Stockfish parameter presets.
 */

import type { EngineProfile, DifficultyLevel } from '../state/contracts';
import { CUSTOM_SKILL_LEVEL_MIN, CUSTOM_SKILL_LEVEL_MAX, CUSTOM_SKILL_LEVEL_DEFAULT } from '../state/contracts';

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

const NAMED_PROFILES: Record<Exclude<DifficultyLevel, 'custom'>, EngineProfile> = {
  easy: EASY,
  casual: CASUAL,
  serious: SERIOUS,
};

function clampCustomLevel(value: number): number {
  if (!Number.isFinite(value)) return CUSTOM_SKILL_LEVEL_DEFAULT;
  const rounded = Math.round(value);
  if (rounded < CUSTOM_SKILL_LEVEL_MIN) return CUSTOM_SKILL_LEVEL_MIN;
  if (rounded > CUSTOM_SKILL_LEVEL_MAX) return CUSTOM_SKILL_LEVEL_MAX;
  return rounded;
}

/**
 * Map the 0..9 custom picker value to a Stockfish profile. Skill spans the full
 * 0..20 Stockfish range; depth scales 4..18 and movetime 400..4000 so weak settings
 * stay snappy and strong settings get enough nodes to actually play well. Levels 0..2
 * enable MultiPV variety so the engine doesn't pick the same line every time at low skill.
 */
export function buildCustomEngineProfile(rawLevel: number): EngineProfile {
  const level = clampCustomLevel(rawLevel);
  const span = CUSTOM_SKILL_LEVEL_MAX - CUSTOM_SKILL_LEVEL_MIN;
  const skillLevel = Math.round((level * 20) / span);
  const depth = 4 + Math.round((level * 14) / span);
  const movetime = 400 + level * 400;
  return {
    name: `Custom ${level}`,
    skillLevel,
    depth,
    movetime,
    addVariety: level <= 2,
  };
}

/**
 * Resolve the engine profile for the current difficulty selection. Named tiers map to
 * the static presets above; 'custom' is built from `customSkillLevel`. Defaults safely
 * to Casual on unknown input.
 */
export function getEngineProfile(level: DifficultyLevel, customSkillLevel: number): EngineProfile {
  if (level === 'custom') return buildCustomEngineProfile(customSkillLevel);
  return NAMED_PROFILES[level] ?? CASUAL;
}
