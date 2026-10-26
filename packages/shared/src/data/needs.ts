/** The needs of a person. Each is 0..100 (100 = satisfied); rates are points per game hour (docs/notes/m1-agent-brain-spec.md, section 3). */
export const NEED_IDS = ['food', 'water', 'rest', 'warmth', 'safety', 'company', 'purpose'] as const;
export type NeedId = (typeof NEED_IDS)[number];

export interface NeedDef {
  id: NeedId;
  label: string;
  /** Points lost per game hour while awake (warmth and safety are driven by the world instead). */
  fall: number;
  /** What the person feels below 30, and below 10. */
  low: string;
  critical: string;
  /** Weight of this need in the mood mean. */
  weight: number;
}

export const NEEDS: Record<NeedId, NeedDef> = {
  food: { id: 'food', label: 'Food', fall: 4, low: 'hungry', critical: 'starving', weight: 1.2 },
  water: { id: 'water', label: 'Water', fall: 5, low: 'thirsty', critical: 'parched', weight: 1 },
  rest: { id: 'rest', label: 'Rest', fall: 4.2, low: 'tired', critical: 'exhausted', weight: 1 },
  warmth: { id: 'warmth', label: 'Warmth', fall: 0, low: 'cold', critical: 'freezing', weight: 0.9 },
  safety: { id: 'safety', label: 'Safety', fall: 0, low: 'anxious', critical: 'terrified', weight: 0.8 },
  company: { id: 'company', label: 'Company', fall: 0.8, low: 'lonely', critical: 'withdrawn', weight: 0.7 },
  purpose: { id: 'purpose', label: 'Purpose', fall: 0.5, low: 'sullen', critical: 'adrift', weight: 0.7 },
};

/** Sleeping restores this many rest points per hour. */
export const SLEEP_RECOVERY = 9;
export const NEED_LOW = 30;
export const NEED_CRITICAL = 10;

/** `((100 - need) / 100)^2 * 3`: how loudly a need calls for attention (docs/notes/m1-agent-brain-spec.md, section 6). */
export function urgency(need: number): number {
  const d = (100 - Math.max(0, Math.min(100, need))) / 100;
  return d * d * 3;
}
