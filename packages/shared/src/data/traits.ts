/**
 * Traits change choices, not just numbers (docs/notes/m1-agent-brain-spec.md, section 5). Each carries small modifiers that
 * the goal scoring, compliance and social code read; `opposite` pairs are never drawn together.
 */
export const TRAIT_IDS = [
  'hardworking', 'lazy', 'brave', 'cowardly', 'honest', 'cunning', 'kind', 'cruel', 'greedy', 'generous',
  'curious', 'devout', 'superstitious', 'proud', 'humble', 'gregarious', 'solitary', 'hot-tempered', 'calm', 'ambitious',
  'content', 'observant', 'clumsy', 'strong', 'frail', 'fast learner', 'stubborn', 'loyal', 'rebellious', 'romantic',
] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

export type ModKey = 'work' | 'rest' | 'risk' | 'social' | 'crime' | 'comply' | 'learn' | 'temper' | 'romance' | 'faith' | 'kind' | 'greed' | 'curious' | 'ambition' | 'vigor';

export interface TraitDef {
  id: TraitId;
  label: string;
  /** One sentence for the villager sheet. */
  desc: string;
  opposite?: TraitId;
  /** Chance weight when a trait is drawn. */
  weight: number;
  mods: Partial<Record<ModKey, number>>;
}

const t = (id: TraitId, desc: string, mods: TraitDef['mods'], opposite?: TraitId, weight = 1): TraitDef => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), desc, mods, opposite, weight });

export const TRAITS: Record<TraitId, TraitDef> = {
  hardworking: t('hardworking', 'Takes work gladly and keeps at it.', { work: 0.3, comply: 0.08 }, 'lazy'),
  lazy: t('lazy', 'Prefers rest and leisure to work; takes jobs rarely.', { work: -0.3, rest: 0.4, comply: -0.1 }, 'hardworking'),
  brave: t('brave', 'Takes risks and defends others.', { risk: 0.5 }, 'cowardly'),
  cowardly: t('cowardly', 'Refuses risky jobs and flees early.', { risk: -0.5 }, 'brave'),
  honest: t('honest', 'Does not steal or deceive, and feels guilty if they do.', { crime: -0.5 }, 'cunning'),
  cunning: t('cunning', 'Steals and deceives with better odds and less guilt.', { crime: 0.5 }, 'honest'),
  kind: t('kind', 'Helps, comforts and gives.', { kind: 0.5, temper: -0.1 }, 'cruel'),
  cruel: t('cruel', "Enjoys other people's troubles; quarrels and threatens.", { kind: -0.5, temper: 0.2, crime: 0.15 }, 'kind'),
  greedy: t('greedy', 'Wants more than their share.', { greed: 0.5, crime: 0.2 }, 'generous'),
  generous: t('generous', 'Gives freely.', { greed: -0.4, kind: 0.2 }, 'greedy'),
  curious: t('curious', 'Explores, studies and asks questions.', { curious: 0.5, learn: 0.1 }),
  devout: t('devout', 'Seeks the shrine and stays calm in a crisis.', { faith: 0.6 }),
  superstitious: t('superstitious', 'Reads omens into everything and fears the Blight.', { faith: 0.3, risk: -0.2 }),
  proud: t('proud', 'Seeks honour and does not apologise easily.', { temper: 0.2, ambition: 0.15 }, 'humble'),
  humble: t('humble', 'Asks for little and apologises readily.', { temper: -0.2, comply: 0.05 }, 'proud'),
  gregarious: t('gregarious', 'Loses company quickly and gains more from socialising.', { social: 0.6 }, 'solitary'),
  solitary: t('solitary', 'Needs little company and likes to be left alone.', { social: -0.5 }, 'gregarious'),
  'hot-tempered': t('hot-tempered', 'Quarrels and brawls easily.', { temper: 0.6 }, 'calm'),
  calm: t('calm', 'Slow to anger, steady in a crisis.', { temper: -0.5, risk: 0.1 }, 'hot-tempered'),
  ambitious: t('ambitious', 'Always reaching for the next thing.', { ambition: 0.5, work: 0.1 }, 'content'),
  content: t('content', 'Happy with what they have.', { ambition: -0.4, rest: 0.1 }, 'ambitious'),
  observant: t('observant', 'Notices who steals and who whispers.', { curious: 0.2 }),
  clumsy: t('clumsy', 'Fumbles work and gets hurt more often.', { vigor: -0.1, risk: -0.1 }),
  strong: t('strong', 'Strong body: more health and faster heavy work.', { vigor: 0.25 }, 'frail'),
  frail: t('frail', 'Weak body: less health, tires sooner.', { vigor: -0.25, rest: 0.2 }, 'strong'),
  'fast learner': t('fast learner', 'Skills grow faster.', { learn: 0.4 }),
  stubborn: t('stubborn', 'Keeps a goal long after it stopped making sense.', { comply: -0.05 }),
  loyal: t('loyal', 'Trusts the manager and sticks by friends.', { comply: 0.15 }, 'rebellious'),
  rebellious: t('rebellious', 'Lowers compliance and risks open defiance.', { comply: -0.25, crime: 0.1 }, 'loyal'),
  romantic: t('romantic', 'Falls in love easily and courts with gifts.', { romance: 0.5 }),
};

/** Sum of one modifier over a person's traits. */
export function traitMod(traits: readonly TraitId[], key: ModKey): number {
  let s = 0;
  for (const id of traits) s += TRAITS[id].mods[key] ?? 0;
  return s;
}
