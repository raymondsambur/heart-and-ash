/**
 * The manager's levers beyond orders (M4): priorities per kind of work, standing rules (a condition and an action) and the
 * decisions the sim puts to the manager (offers). Everything here is data both the sim and the client read.
 */
import type { BuildKind } from './blueprints';

/** Kinds of work the manager can weigh against each other. Every job on the board belongs to one. */
export const JOB_GROUPS = ['food', 'wood', 'stone', 'building', 'defence', 'care', 'crafts'] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];

export const GROUP_LABEL: Record<JobGroup, string> = {
  food: 'Food',
  wood: 'Wood and planks',
  stone: 'Stone',
  building: 'Building',
  defence: 'Defence',
  care: 'Care and burials',
  crafts: 'Tools and cloth',
};

/** Which group a job on the board belongs to, from the prefix of its key (`harvest:2`, `wood:stock`, `haul:3:planks`). */
const GROUP_OF: Record<string, JobGroup> = {
  plant: 'food',
  tend: 'food',
  harvest: 'food',
  forage: 'food',
  fish: 'food',
  hunt: 'food',
  cook: 'food',
  wood: 'wood',
  planks: 'wood',
  thatch: 'wood',
  stone: 'stone',
  haul: 'building',
  build: 'building',
  demolish: 'building',
  rubble: 'building',
  watch: 'defence',
  herbs: 'care',
  funeral: 'care',
  cloth: 'crafts',
  tool: 'crafts',
};

export function groupOfJob(type: string): JobGroup | null {
  return GROUP_OF[type] ?? null;
}

/** 0 off, 1 low, 2 normal, 3 high, 4 urgent: what the manager sets, and how much it scales how attractive a job is. */
export const PRIORITY_LEVELS = [0, 1, 2, 3, 4] as const;
export const PRIORITY_LABEL = ['Off', 'Low', 'Normal', 'High', 'Urgent'] as const;
export const PRIORITY_MULT = [0.15, 0.6, 1, 1.5, 2.3] as const;
export const DEFAULT_PRIORITY = 2;

// ---------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------

/** What a rule's condition can look at. */
export const RULE_METRICS = ['foodDays', 'fuelDays', 'population', 'houses', 'fields', 'shrines', 'watchposts', 'walls', 'wood', 'stone', 'planks', 'mood', 'sick', 'season', 'raid'] as const;
export type RuleMetric = (typeof RULE_METRICS)[number];

export const METRIC_LABEL: Record<RuleMetric, string> = {
  foodDays: 'days of food',
  fuelDays: 'days of winter fuel',
  population: 'people',
  houses: 'houses',
  fields: 'fields',
  shrines: 'shrines',
  watchposts: 'watch posts',
  walls: 'wall segments',
  wood: 'wood in store',
  stone: 'stone in store',
  planks: 'planks in store',
  mood: 'average mood',
  sick: 'people sick',
  season: 'season (0 spring, 3 winter)',
  raid: 'raiders expected (1 yes)',
};

export type RuleOp = '<' | '>' | '=';

export interface RuleCond {
  metric: RuleMetric;
  op: RuleOp;
  value: number;
}

export type RuleAct =
  /** Set the rations (0 normal, 1 tight, 2 strict). */
  | { t: 'ration'; level: 0 | 1 | 2 }
  /** Set the priority of a kind of work. */
  | { t: 'priority'; group: JobGroup; level: number }
  /** Order a building of a kind on a good spot near the green, when none of that kind is already being raised. */
  | { t: 'build'; kind: BuildKind };

/** A standing rule: while the condition holds the action is applied (a build once every few days). */
export interface RuleDef {
  id: number;
  enabled: boolean;
  cond: RuleCond;
  act: RuleAct;
}

export const MAX_RULES = 12;

/**
 * A set of rules that looks after a village by itself: rations follow the food, the watch gets urgent when raiders are expected,
 * wood is pressed when the winter fuel is short, and a few buildings are raised as the village needs them. The "Add suggested rules"
 * button adds these, and the soak runs on them to check a village left to its rules does well.
 */
export const CARETAKER_RULES: readonly Omit<RuleDef, 'id'>[] = [
  { enabled: true, cond: { metric: 'foodDays', op: '>', value: 14 }, act: { t: 'ration', level: 0 } },
  { enabled: true, cond: { metric: 'foodDays', op: '<', value: 7 }, act: { t: 'ration', level: 1 } },
  { enabled: true, cond: { metric: 'foodDays', op: '<', value: 3.5 }, act: { t: 'ration', level: 2 } },
  { enabled: true, cond: { metric: 'raid', op: '=', value: 0 }, act: { t: 'priority', group: 'defence', level: 2 } },
  { enabled: true, cond: { metric: 'raid', op: '=', value: 1 }, act: { t: 'priority', group: 'defence', level: 4 } },
  { enabled: true, cond: { metric: 'fuelDays', op: '>', value: 24 }, act: { t: 'priority', group: 'wood', level: 2 } },
  { enabled: true, cond: { metric: 'fuelDays', op: '<', value: 12 }, act: { t: 'priority', group: 'wood', level: 4 } },
  { enabled: true, cond: { metric: 'houses', op: '<', value: 7 }, act: { t: 'build', kind: 'house' } },
  { enabled: true, cond: { metric: 'watchposts', op: '<', value: 2 }, act: { t: 'build', kind: 'watchpost' } },
  { enabled: true, cond: { metric: 'walls', op: '<', value: 3 }, act: { t: 'build', kind: 'wall' } },
  { enabled: true, cond: { metric: 'shrines', op: '<', value: 2 }, act: { t: 'build', kind: 'shrine' } },
  { enabled: true, cond: { metric: 'fields', op: '<', value: 3 }, act: { t: 'build', kind: 'field' } },
];
/** Days a `build` rule waits after it has placed an order. */
export const BUILD_RULE_COOLDOWN = 3;

// ---------------------------------------------------------------------------------------------------
// Offers: decisions the manager is asked to make
// ---------------------------------------------------------------------------------------------------

export interface OfferOption {
  id: string;
  label: string;
  /** What choosing it costs or brings, in words. */
  note: string;
}

export interface OfferView {
  id: number;
  kind: 'refugees' | 'envoy' | 'trader';
  title: string;
  text: string;
  day: number;
  /** The day it is settled for the manager if nobody answers (and what happens then is `fallback`). */
  expires: number;
  options: OfferOption[];
  fallback: string;
}

// ---------------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------------

export type ReportTone = 'good' | 'bad' | 'warn' | 'info';

export interface ReportLine {
  text: string;
  tone: ReportTone;
}

export interface ReportView {
  id: number;
  kind: 'day' | 'season' | 'away';
  /** The day the report is about (for a season, its last day; for the away report, the day the manager came back). */
  day: number;
  title: string;
  lines: ReportLine[];
  /** Not yet read by the manager. */
  unread: boolean;
}

export interface PolicyView {
  /** Priority level per group, in `JOB_GROUPS` order. */
  priorities: number[];
  rules: RuleDef[];
  offers: OfferView[];
  /** True while the village runs without the manager (the host sets it), and the state it is in. */
  away: boolean;
  /** Set when the village stopped itself because a crisis would have ended it. */
  crisis: string | null;
}
