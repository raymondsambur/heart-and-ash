/**
 * The action library (docs/notes/m1-agent-brain-spec.md, section 8). One row per thing a villager can do. Adding an action
 * adds a row here (and, for anything beyond a plain effect, a handler in `packages/sim/src/actions.ts`); the `verb` is what
 * the villager sheet and the explanations show, so a new action explains itself without UI work.
 *
 * The planner reads `plan`: what the hands must hold, what must be in the store, what the action leaves in the hands, and
 * which need it feeds. Actions without `plan` are not found by search; they happen as the target of a goal (a job, an
 * ambition step, a social act) or as a life event.
 */
import type { Good } from './goods';
import type { NeedId } from './needs';
import type { SkillId } from './skills';

/** Where an action happens. `water` is the well or the stream, `person` is next to another villager, `here` is anywhere. */
export type PlaceKind = 'here' | 'home' | 'store' | 'field' | 'water' | 'stream' | 'forest' | 'quarry' | 'meadow' | 'plaza' | 'shrine' | 'edge' | 'person' | 'buildsite' | 'post';

export type ActionGroup = 'survival' | 'food' | 'crafting' | 'care' | 'social' | 'conflict' | 'duty' | 'life' | 'construction';
export type ActionTag = 'work' | 'leisure' | 'social' | 'risky' | 'crime' | 'violent' | 'faith' | 'care' | 'romance' | 'learn' | 'rest';

export interface ActionPlan {
  /** The hands must hold this before: a good, `food` (raw or cooked), `any` good, or be `empty`. */
  holds?: Good | 'food' | 'any' | 'empty';
  /** The village store must hold this good (the action takes it into the hands). */
  store?: Good;
  /** A tool is needed (the planner adds fetching one from the store when the person has none). */
  tool?: boolean;
  /** A field of this state must exist. */
  field?: 'ripe' | 'fallow' | 'growing';
  /** What the hands hold afterwards (`empty` or a good); when absent the hands are unchanged. */
  gives?: Good | 'empty';
  /** Need points gained when the action is done. */
  need?: Partial<Record<NeedId, number>>;
  /** The carried good goes into the village store. */
  stores?: true;
}

export interface ActionDef {
  id: string;
  verb: string;
  group: ActionGroup;
  at: PlaceKind;
  /** Game minutes at skill 0. */
  minutes: number;
  skill?: SkillId;
  minSkill?: number;
  tags: ActionTag[];
  /** Allowed hours of the day, `[from, to]`, wrapping past midnight when from > to. */
  hours?: [number, number];
  /** Allowed seasons (0 spring .. 3 winter). */
  seasons?: number[];
  /** False for rows that exist for later milestones. */
  active: boolean;
  plan?: ActionPlan;
}

type Opts = Partial<Omit<ActionDef, 'id' | 'verb' | 'group' | 'at' | 'minutes' | 'tags' | 'active'>> & { tags?: ActionTag[]; active?: boolean };

const rows: ActionDef[] = [];
function a(id: string, verb: string, group: ActionGroup, at: PlaceKind, minutes: number, o: Opts = {}): void {
  rows.push({ id, verb, group, at, minutes, tags: o.tags ?? [], active: o.active ?? true, skill: o.skill, minSkill: o.minSkill, hours: o.hours, seasons: o.seasons, plan: o.plan });
}

// ---- survival ----------------------------------------------------------------------------------
a('eat', 'eating', 'survival', 'here', 15, { plan: { holds: 'food', gives: 'empty', need: { food: 32 } } });
a('drink', 'drinking', 'survival', 'water', 5, { plan: { need: { water: 40 } } });
a('sleep', 'sleeping', 'survival', 'home', 480, { tags: ['rest'], plan: { need: { rest: 96 } } });
a('warm_up', 'warming up by the fire', 'survival', 'home', 30, { plan: { need: { warmth: 40 } } });
a('light_fire', 'lighting the hearth', 'survival', 'home', 10, { plan: { holds: 'wood', gives: 'empty', need: { warmth: 15 } } });
a('seek_shelter', 'taking shelter', 'survival', 'home', 20, { plan: { need: { warmth: 25, safety: 20 } } });
a('dress_cold', 'putting on warm clothes', 'survival', 'home', 15, { plan: { holds: 'cloth', gives: 'empty', need: { warmth: 10 } } });
a('treat_wound', 'tending a wound', 'survival', 'home', 20, { tags: ['care'], plan: { holds: 'herb', gives: 'empty' } });

// ---- food and materials ---------------------------------------------------------------------------
a('plant', 'planting the field', 'food', 'field', 180, { skill: 'farming', seasons: [0, 1], tags: ['work'], plan: { field: 'fallow' } });
a('tend_crops', 'tending the crops', 'food', 'field', 90, { skill: 'farming', seasons: [0, 1, 2], tags: ['work'], plan: { field: 'growing' } });
a('harvest', 'harvesting', 'food', 'field', 120, { skill: 'farming', tags: ['work'], plan: { field: 'ripe', holds: 'empty', gives: 'ration' } });
a('forage', 'foraging', 'food', 'meadow', 180, { skill: 'foraging', seasons: [0, 1, 2], tags: ['work'], plan: { holds: 'empty', gives: 'ration' } });
a('cut_thatch', 'cutting thatch', 'food', 'meadow', 150, { skill: 'foraging', seasons: [0, 1, 2], tags: ['work'], plan: { holds: 'empty', gives: 'thatch' } });
a('gather_herbs', 'gathering herbs', 'food', 'meadow', 150, { skill: 'foraging', seasons: [0, 1, 2], tags: ['work'], plan: { holds: 'empty', gives: 'herb' } });
a('hunt', 'hunting', 'food', 'forest', 240, { skill: 'hunting', tags: ['work', 'risky'], plan: { holds: 'empty', tool: true, gives: 'ration' } });
a('fish', 'fishing', 'food', 'stream', 180, { skill: 'foraging', tags: ['work'], plan: { holds: 'empty', gives: 'ration' } });
a('chop_wood', 'chopping wood', 'food', 'forest', 180, { skill: 'woodcraft', tags: ['work'], plan: { holds: 'empty', tool: true, gives: 'wood' } });
a('saw_planks', 'sawing planks', 'food', 'store', 120, { skill: 'woodcraft', tags: ['work'], plan: { holds: 'wood', gives: 'planks' } });
a('quarry_stone', 'quarrying stone', 'food', 'quarry', 180, { skill: 'mining', tags: ['work'], plan: { holds: 'empty', tool: true, gives: 'stone' } });
a('mine_ore', 'mining ore', 'food', 'quarry', 180, { skill: 'mining', minSkill: 3, tags: ['work', 'risky'], plan: { holds: 'empty', tool: true, gives: 'ore' } });
a('haul_item', 'hauling', 'food', 'here', 0, { tags: ['work'] });
a('store_item', 'storing goods', 'food', 'store', 5, { tags: ['work'], plan: { holds: 'any', gives: 'empty', stores: true } });
a('take_item', 'fetching from the store', 'food', 'store', 5, { plan: { holds: 'empty' } });

// ---- crafting ---------------------------------------------------------------------------------------
a('cook', 'cooking', 'crafting', 'home', 45, { skill: 'cooking', tags: ['work'], plan: { holds: 'ration', gives: 'meal' } });
a('brew_wine', 'brewing wine', 'crafting', 'home', 120, { skill: 'cooking', minSkill: 3, tags: ['work'], plan: { holds: 'ration', gives: 'wine' } });
a('make_tool', 'making a tool', 'crafting', 'home', 120, { skill: 'crafting', tags: ['work'], plan: { holds: 'wood', gives: 'empty' } });
a('smith_blade', 'forging a blade', 'crafting', 'home', 240, { skill: 'smithing', minSkill: 4, tags: ['work'], plan: { holds: 'ore', gives: 'blade' } });
a('weave_cloth', 'weaving cloth', 'crafting', 'home', 180, { skill: 'crafting', tags: ['work'], plan: { holds: 'herb', gives: 'cloth' } });
a('sew_clothing', 'sewing clothes', 'crafting', 'home', 120, { skill: 'crafting', tags: ['work'], plan: { holds: 'cloth', gives: 'empty' } });
a('repair_tool', 'repairing a tool', 'crafting', 'home', 30, { skill: 'crafting', tags: ['work'], plan: { tool: true } });

// ---- care and learning -------------------------------------------------------------------------------------
a('heal', 'healing someone', 'care', 'person', 60, { skill: 'healing', tags: ['care', 'work'] });
a('nurse_sick', 'nursing the sick', 'care', 'person', 90, { skill: 'healing', tags: ['care', 'work'] });
a('teach', 'teaching', 'care', 'person', 90, { skill: 'teaching', tags: ['learn', 'social'] });
a('study', 'studying', 'care', 'home', 120, { skill: 'scholarship', tags: ['learn', 'leisure'] });
a('pray', 'praying at the shrine', 'care', 'shrine', 30, { tags: ['faith'], plan: { need: { purpose: 8, safety: 12 } } });
a('mourn', 'mourning', 'care', 'shrine', 60, { tags: ['faith'] });
a('bury_dead', 'burying the dead', 'care', 'shrine', 90, { tags: ['faith', 'care', 'work'] });

// ---- social ---------------------------------------------------------------------------------------------------
a('chat', 'chatting', 'social', 'person', 20, { tags: ['social', 'leisure'], plan: { need: { company: 25 } } });
a('gossip', 'gossiping', 'social', 'person', 15, { tags: ['social', 'leisure'] });
a('help_with_work', 'helping with the work', 'social', 'person', 60, { tags: ['social', 'work'] });
a('court', 'courting', 'social', 'person', 30, { tags: ['social', 'romance'] });
a('propose', 'proposing', 'social', 'person', 15, { tags: ['social', 'romance'] });
a('marry', 'getting married', 'social', 'shrine', 60, { tags: ['social', 'romance', 'faith'] });
a('quarrel', 'quarrelling', 'social', 'person', 10, { tags: ['social'] });
a('apologise', 'apologising', 'social', 'person', 10, { tags: ['social'] });
a('gift', 'giving a gift', 'social', 'person', 10, { tags: ['social'] });
a('barter', 'bartering', 'social', 'person', 15, { skill: 'trading', tags: ['social', 'work'] });
a('tell_story', 'telling a story', 'social', 'plaza', 30, { tags: ['social', 'leisure'] });
a('celebrate', 'celebrating', 'social', 'plaza', 60, { tags: ['social', 'leisure'] });
a('wander', 'wandering about', 'social', 'here', 30, { tags: ['leisure'] });
a('play', 'playing', 'social', 'plaza', 40, { tags: ['leisure', 'social'] });
a('comfort', 'comforting someone', 'social', 'person', 20, { tags: ['social', 'care'] });

// ---- conflict and crime -----------------------------------------------------------------------------------------
a('brawl', 'brawling', 'conflict', 'person', 5, { skill: 'fighting', tags: ['violent', 'risky'] });
a('duel', 'duelling for honour', 'conflict', 'plaza', 15, { skill: 'fighting', tags: ['violent', 'risky'] });
a('steal', 'stealing from the store', 'conflict', 'store', 10, { tags: ['crime', 'risky'] });
a('deceive', 'deceiving someone', 'conflict', 'person', 10, { tags: ['crime', 'social'] });
a('threaten', 'threatening someone', 'conflict', 'person', 5, { tags: ['violent', 'social'] });
a('sabotage', 'sabotaging the fields', 'conflict', 'field', 20, { tags: ['crime'] });
a('neglect_duty', 'slacking off', 'conflict', 'here', 60, { tags: ['leisure'] });
a('flee', 'fleeing', 'conflict', 'home', 5, { tags: ['risky'] });
a('fight_raiders', 'fighting raiders', 'conflict', 'here', 30, { skill: 'fighting', tags: ['violent', 'risky'], active: false });

// ---- duty -------------------------------------------------------------------------------------------------------
a('patrol', 'patrolling', 'duty', 'plaza', 120, { skill: 'fighting', tags: ['work'] });
a('stand_watch', 'standing watch', 'duty', 'plaza', 240, { skill: 'fighting', tags: ['work'] });
a('report_for_work', 'reporting for work', 'duty', 'here', 5, { tags: ['work'] });

// ---- life (events, not choices) -------------------------------------------------------------------------------------
a('leave_village', 'leaving the village', 'life', 'edge', 5);
a('return_village', 'returning to the village', 'life', 'edge', 5);
a('give_birth', 'giving birth', 'life', 'home', 0);
a('grow_up', 'coming of age', 'life', 'here', 0);
a('fall_ill', 'falling ill', 'life', 'here', 0);
a('recover', 'recovering', 'life', 'here', 0);
a('die', 'dying', 'life', 'here', 0);

// ---- construction (stubs for M2: present, inactive) ----------------------------------------------------------------------
// M2: work on an order (a plot someone is raising or pulling down). The goal names the order; `deliver_material` is found by the
// planner (fetch the good from the store, then bring it to the plot), the three others are the target of a job.
a('build', 'building', 'construction', 'buildsite', 30, { skill: 'building', tags: ['work'] });
a('demolish', 'pulling a building down', 'construction', 'buildsite', 30, { skill: 'building', tags: ['work'] });
a('clear_rubble', 'clearing rubble', 'construction', 'buildsite', 30, { tags: ['work'] });
a('deliver_material', 'bringing building material', 'construction', 'buildsite', 5, { tags: ['work'], plan: { holds: 'any', gives: 'empty' } });

export const ACTION_LIST: readonly ActionDef[] = rows;
export const ACTIONS: Record<string, ActionDef> = Object.fromEntries(rows.map((r) => [r.id, r]));

export function actionHour(def: ActionDef, hour: number): boolean {
  if (!def.hours) return true;
  const [from, to] = def.hours;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}
