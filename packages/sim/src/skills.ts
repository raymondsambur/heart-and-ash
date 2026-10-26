/** Skill growth and speed (docs/notes/m1-agent-brain-spec.md, section 4). */
import { MAX_SKILL, skillSpeed, traitMod, xpToNext, type SkillId } from '@hearth/shared';
import { ageOf } from './people';
import type { Person } from './types';

/** How fast this person learns: a fast learner learns more, the young more, the very old less, and a teacher nearby doubles it. */
export function learnRate(p: Person, day: number, teacher: boolean): number {
  const age = ageOf(p, day);
  const ageF = age < 20 ? 1.3 : age >= 70 ? 0.5 : age >= 60 ? 0.75 : 1;
  return Math.max(0.2, (1 + traitMod(p.traits, 'learn')) * ageF * (teacher ? 2 : 1));
}

/** Add experience; returns the new level when it went up. */
export function gainXp(p: Person, skill: SkillId, amount: number, day: number, teacher = false): number | null {
  const s = p.skills[skill];
  if (s.lv >= MAX_SKILL) return null;
  s.xp += amount * learnRate(p, day, teacher);
  let up: number | null = null;
  while (s.lv < MAX_SKILL && s.xp >= xpToNext(s.lv)) {
    s.xp -= xpToNext(s.lv);
    s.lv++;
    up = s.lv;
  }
  return up;
}

export function speedOf(p: Person, skill: SkillId | undefined): number {
  if (!skill) return 1;
  const strong = 1 + Math.max(-0.2, traitMod(p.traits, 'vigor') * 0.3);
  return skillSpeed(p.skills[skill].lv) * strong;
}
