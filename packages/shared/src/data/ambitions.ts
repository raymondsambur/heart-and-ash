/**
 * The ambition catalogue (docs/notes/m1-agent-brain-spec.md, section 10): what a villager can dream of. The rules that
 * advance each kind live in `packages/sim/src/ambitions.ts`; this table says what they are called, who is drawn to them and
 * whether they wait for construction (M2).
 */
import type { SkillId } from './skills';
import type { TraitId } from './traits';

export const AMBITION_KINDS = [
  'own_house', 'marry', 'raise_children', 'open_stall', 'master_skill', 'take_apprentice', 'protect_village', 'get_rich', 'see_outside',
  'take_revenge', 'win_honour', 'heal_sick', 'build_shrine', 'reconcile', 'be_left_alone', 'court_person', 'find_kin', 'perfect_recipe',
  'tend_garden', 'keep_faith', 'cure_blight', 'earn_trust', 'escape_debt', 'storyteller', 'cheat_system',
] as const;
export type AmbitionKind = (typeof AMBITION_KINDS)[number];

export interface AmbitionDef {
  id: AmbitionKind;
  label: string;
  /** Sentence for the sheet; `{skill}` and `{who}` are filled from the ambition's parameters. */
  desc: string;
  /** Needs a building that only M2 can raise: such an ambition posts a request and waits. */
  needsConstruction?: boolean;
  minAge: number;
  /** Base weight when drawing ambitions, and the traits that pull a person towards it. */
  weight: number;
  likes: Partial<Record<TraitId, number>>;
  /** Skills that make it likelier. */
  skills?: SkillId[];
}

const d = (id: AmbitionKind, label: string, desc: string, weight: number, likes: AmbitionDef['likes'], o: Partial<AmbitionDef> = {}): AmbitionDef => ({ id, label, desc, weight, likes, minAge: o.minAge ?? 14, needsConstruction: o.needsConstruction, skills: o.skills });

export const AMBITIONS: Record<AmbitionKind, AmbitionDef> = {
  own_house: d('own_house', 'Own a house', 'Wants a house of their own.', 1.2, { ambitious: 1, hardworking: 0.5 }, { minAge: 16 }),
  marry: d('marry', 'Marry', 'Hopes to marry.', 1.6, { romantic: 1.2, gregarious: 0.5 }, { minAge: 16 }),
  raise_children: d('raise_children', 'Raise children', 'Wants a family and children.', 1, { kind: 0.6, romantic: 0.6, content: 0.4 }, { minAge: 18 }),
  open_stall: d('open_stall', 'Open a stall', 'Dreams of a stall at the plaza.', 1, { ambitious: 0.8, greedy: 0.6, gregarious: 0.5 }, { skills: ['trading', 'cooking', 'crafting'], minAge: 16 }),
  master_skill: d('master_skill', 'Become a master', 'Wants to become a master of {skill}.', 1.3, { ambitious: 1, 'fast learner': 0.8, hardworking: 0.5 }),
  take_apprentice: d('take_apprentice', 'Take an apprentice', 'Wants to pass their craft on to an apprentice.', 0.8, { kind: 0.7, humble: 0.3 }, { skills: ['teaching'], minAge: 24 }),
  protect_village: d('protect_village', 'Protect the village', 'Wants to keep the village safe.', 0.9, { brave: 1, loyal: 0.8 }, { skills: ['fighting'], minAge: 16 }),
  get_rich: d('get_rich', 'Get rich', 'Wants to be rich.', 0.9, { greedy: 1, ambitious: 0.7, cunning: 0.3 }, { skills: ['trading'], minAge: 16 }),
  see_outside: d('see_outside', 'See the Outside', 'Wants to see the world beyond the village.', 0.8, { curious: 1, ambitious: 0.4 }, { minAge: 16 }),
  take_revenge: d('take_revenge', 'Take revenge', 'Cannot forget a wrong done to them.', 0.4, { 'hot-tempered': 1, cruel: 0.6, proud: 0.5 }, { minAge: 16 }),
  win_honour: d('win_honour', 'Win honour', 'Wants to win honour in a duel.', 0.7, { proud: 1, 'hot-tempered': 0.6, brave: 0.6 }, { skills: ['fighting'], minAge: 16 }),
  heal_sick: d('heal_sick', 'Heal the sick', 'Wants to tend the ill and heal them.', 0.8, { kind: 0.9, devout: 0.5 }, { skills: ['healing'], minAge: 16 }),
  build_shrine: d('build_shrine', 'Build something great', 'Dreams of raising a great shrine.', 0.5, { devout: 1, ambitious: 0.6 }, { minAge: 20 }),
  reconcile: d('reconcile', 'Make peace', 'Wants to make peace with {who}.', 0.5, { kind: 0.7, calm: 0.6, humble: 0.6 }, { minAge: 16 }),
  be_left_alone: d('be_left_alone', 'Be left alone', 'Wants to be left alone, away from the crowd.', 0.5, { solitary: 1.2 }, { minAge: 16 }),
  court_person: d('court_person', 'Win a heart', 'Has set their heart on {who}.', 0.9, { romantic: 1.2 }, { minAge: 16 }),
  find_kin: d('find_kin', 'Find lost kin', 'Wants to find family they lost.', 0.4, { loyal: 0.5, curious: 0.4 }, { minAge: 16 }),
  perfect_recipe: d('perfect_recipe', 'Perfect a recipe', 'Wants to perfect a dish.', 0.7, { content: 0.4, generous: 0.5, curious: 0.3 }, { skills: ['cooking'], minAge: 16 }),
  tend_garden: d('tend_garden', 'Tend a garden', 'Dreams of a garden that is the pride of the village.', 0.8, { content: 1, calm: 0.4, hardworking: 0.3 }, { skills: ['farming'], minAge: 16 }),
  keep_faith: d('keep_faith', 'Keep the faith', 'Wants to keep the old rites.', 0.8, { devout: 1.2, superstitious: 0.5 }, { minAge: 14 }),
  cure_blight: d('cure_blight', "Find the Blight's cure", "Wants to find a cure for the Blight.", 0.9, { curious: 1.2, kind: 0.5 }, { skills: ['scholarship', 'healing'], minAge: 18 }),
  earn_trust: d('earn_trust', "Earn the manager's trust", "Wants to earn the manager's trust.", 0.7, { loyal: 1, humble: 0.5, ambitious: 0.3 }, { minAge: 14 }),
  escape_debt: d('escape_debt', 'Escape debt', 'Is in debt and wants to be free of it.', 0, { greedy: 0.3 }, { minAge: 16 }),
  storyteller: d('storyteller', 'Be a storyteller', 'Wants to be the one who tells the stories at feasts.', 0.6, { gregarious: 1, curious: 0.4 }, { minAge: 14 }),
  cheat_system: d('cheat_system', 'Beat the system', 'Wants to live well without working for it.', 0.4, { cunning: 1, greedy: 0.7, lazy: 0.5 }, { minAge: 16 }),
};

export interface Ambition {
  kind: AmbitionKind;
  /** The skill or the other person the ambition is about. */
  skill?: SkillId;
  who?: number;
  /** 0..1, from milestones, not a timer. */
  progress: number;
  startedDay: number;
  /** Why it is stuck right now, if it is. */
  stuck?: string;
  /** Free counters the rules use (steps done, goods sold, ...). */
  n?: number;
  /** Set once the ambition has ended: `fulfilled` or `abandoned`, with the day. */
  ended?: { how: 'fulfilled' | 'abandoned'; day: number; why?: string };
}
