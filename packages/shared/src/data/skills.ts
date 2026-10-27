/** Skills: level 0..20, learned by use (docs/notes/m1-agent-brain-spec.md, section 4). */
export const SKILL_IDS = ['farming', 'foraging', 'hunting', 'woodcraft', 'mining', 'building', 'smithing', 'cooking', 'crafting', 'healing', 'teaching', 'trading', 'fighting', 'scholarship', 'leadership'] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const SKILL_LABEL: Record<SkillId, string> = {
  farming: 'Farming',
  foraging: 'Foraging',
  hunting: 'Hunting',
  woodcraft: 'Woodcraft',
  mining: 'Mining',
  building: 'Building',
  smithing: 'Smithing',
  cooking: 'Cooking',
  crafting: 'Crafting',
  healing: 'Healing',
  teaching: 'Teaching',
  trading: 'Trading',
  fighting: 'Fighting',
  scholarship: 'Scholarship',
  leadership: 'Leadership',
};

export const MAX_SKILL = 20;

/** Experience needed to go from `lv` to `lv + 1`. */
export function xpToNext(lv: number): number {
  return Math.round(40 * Math.pow(lv + 1, 1.4));
}

/** Work speed from a skill level: `1 + 0.08 * lv`. */
export function skillSpeed(lv: number): number {
  return 1 + 0.08 * lv;
}
