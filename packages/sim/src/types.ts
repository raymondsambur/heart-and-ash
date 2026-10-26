import type { Ambition, BuildingDef, Dir, Good, Look, NeedId, NpcAct, PlaceKind, PlotDef, Point, SkillId, Speed, TraitId, WeatherKind } from '@hearth/shared';

// ---------------------------------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------------------------------

/** A concrete place on the map that an action can resolve to. The list is derived from the map and the buildings. */
export interface Site {
  id: number;
  kind: PlaceKind;
  x: number;
  y: number;
  /** Building or plot behind the site, when there is one. */
  building?: number;
  plot?: number;
}

/** What grows in a field. */
export interface Field {
  plot: number;
  state: 'fallow' | 'growing' | 'ripe';
  /** Labour hours still needed to plant it (fallow) or tend it. */
  plantWork: number;
  /** Day the crop went in, days it has grown (frozen in winter) and hours of tending put in since. */
  plantedDay: number;
  grown: number;
  tended: number;
  /** Rations still standing in the field once ripe, and how much the crop was worth when it ripened. */
  left: number;
  /** Skill of whoever did most of the planting (drives the yield). */
  skill: number;
  /** A saboteur's damage, 0..1. */
  damage: number;
}

// ---------------------------------------------------------------------------------------------------
// Goals, plans, jobs
// ---------------------------------------------------------------------------------------------------

export type GoalSource = 'danger' | 'need' | 'job' | 'ambition' | 'leisure' | 'duty' | 'social';

export type Goal =
  /** Bring a need back up. */
  | { kind: 'need'; need: NeedId; label: string }
  /** Put more of a good into the village store. */
  | { kind: 'stock'; good: Good; label: string }
  /** Do one specific thing, possibly to a place or a person. */
  | { kind: 'act'; action: string; site?: number; plot?: number; who?: number; label: string };

/** One step of a plan. The planner leaves `site` and `who` open; the executor resolves them when the step starts. */
export interface Step {
  a: string;
  at: PlaceKind;
  site?: number;
  plot?: number;
  who?: number;
  good?: Good;
  /** How much to take or move. */
  n?: number;
  /** The tile the step goes to, once resolved. */
  tx?: number;
  ty?: number;
}

export interface Act {
  step: Step;
  startedAt: number;
  endsAt: number;
  /** For a joint act: the other person. */
  who?: number;
}

export interface Why {
  goal: string;
  source: GoalSource;
  /** The three best candidates of the last decision, with their scores. */
  top: { label: string; source: GoalSource; score: number }[];
  /** The plan in words. */
  plan: string;
  /** Set when the person could not find a way. */
  blocked?: string;
}

/** A goal a person could pick, with its score and where it came from. */
export interface Cand {
  goal: Goal;
  source: GoalSource;
  score: number;
  label: string;
  jobId?: number;
}

export interface Job {
  id: number;
  /** Stable identity of the work (`harvest:2`, `wood:stock`): the id and the claims survive a refresh. */
  key: string;
  type: string;
  goal: Goal;
  /** 1..5. */
  priority: number;
  /** How many people the job can use at once. */
  slots: number;
  claimed: number[];
  /** Minimum skill level. */
  minSkill?: number;
  skill?: SkillId;
  place?: PlaceKind;
  risky?: boolean;
  /** Seasons the job is open in. */
  label: string;
}

// ---------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------

export interface Relation {
  /** 0..100. */
  fam: number;
  /** -100..100. */
  aff: number;
  /** 0..100. */
  rom: number;
  last: number;
}

export interface Memory {
  /** What happened, as a sentence about the person (`{who}` is filled in when shown). */
  what: string;
  kind: string;
  who?: number;
  /** Game day. */
  day: number;
  /** -1..1. */
  val: number;
  /** Starts at 1 and halves every 20 game days unless reinforced. */
  w: number;
  /** A fact heard from someone else (gossip): who told them. */
  from?: number;
}

export interface MoodEvent {
  text: string;
  v: number;
  until: number;
}

export interface Ill {
  id: string;
  since: number;
}

export interface Person {
  id: number;
  name: string;
  look: Look;
  sex: 0 | 1;
  /** Game day of birth; negative for people who were already alive on day 0. */
  born: number;
  parents: number[];
  partner: number | null;
  children: number[];
  /** Building id of the house they sleep in; null when homeless. */
  home: number | null;

  // movement
  x: number;
  y: number;
  path: Point[];
  nx: number;
  ny: number;
  stepMs: number;
  stepLeft: number;
  face: Dir;
  /** Inside a building (not drawn). */
  hidden: boolean;

  // body and mind
  needs: Record<NeedId, number>;
  hp: number;
  maxHp: number;
  ills: Ill[];
  skills: Record<SkillId, { lv: number; xp: number }>;
  traits: TraitId[];
  ambitions: Ambition[];
  loyalty: number;
  mood: number;
  moodEvents: MoodEvent[];
  relations: Record<number, Relation>;
  memory: Memory[];
  /** Site ids they know of. */
  known: number[];
  carrying: { good: Good; qty: number } | null;
  silver: number;
  /** Personal things: tools, clothes. */
  inv: { tool: number; clothes: number };
  /** Hour offset of their sleep rhythm (hours, -1.5..1.5). */
  rhythm: number;

  // deciding and doing
  goal: Goal | null;
  source: GoalSource | null;
  goalSince: number;
  plan: Step[];
  planIdx: number;
  act: Act | null;
  /** Standing in a joint act with someone else until then (their own plan is paused). */
  talk: { with: number; until: number; kind: string } | null;
  job: number | null;
  why: Why;
  nextDecide: number;
  /** How many plans in a row found nothing, and the blocker text. */
  fails: number;
  blocked: { reason: string; since: number } | null;
  /** The last thing they did and when, for the sheet. */
  lastAct: string;
  /** Pregnancy: day the child is due and the father. */
  pregnant: { due: number; father: number } | null;
  /** Days the person has gone without being thanked, caught stealing etc. are tracked in memory; this is the debt. */
  debt: number;
  /** A stall at the plaza: goods for sale. */
  stall: boolean;
  /** Set while away from the map (see the Outside). */
  away: { since: number; returns: boolean } | null;
  /** Day they last went to the shrine, and what they did that day (small counters for ambitions). */
  counters: Record<string, number>;
}

export interface Grave {
  id: number;
  name: string;
  died: number;
  cause: string;
  age: number;
  buried: boolean;
}

export interface FeedItem {
  id: number;
  day: number;
  hour: number;
  kind: string;
  text: string;
  people: number[];
}

// ---------------------------------------------------------------------------------------------------
// Commands and results
// ---------------------------------------------------------------------------------------------------

export type SimCommand = { t: 'speed'; speed: Speed };

export type CommandResult = { ok: true } | { ok: false; code: string; text: string };

export type SimEvent =
  | { t: 'day'; day: number }
  | { t: 'season'; season: number; year: number }
  | { t: 'weather'; kind: WeatherKind }
  | { t: 'feed'; item: FeedItem };

// ---------------------------------------------------------------------------------------------------
// The whole mutable state
// ---------------------------------------------------------------------------------------------------

export interface SimState {
  seed: number;
  /** Game ms since the village began. */
  totalMs: number;
  /** Game ms not yet consumed by a whole step (so chunking of `step` calls never changes the result). */
  carryMs: number;
  speed: Speed;
  weather: WeatherKind;
  nextId: number;
  villageName: string;
  stock: Record<Good, number>;
  buildings: BuildingDef[];
  plots: PlotDef[];
  fields: Field[];
  jobs: Job[];
  nextJobId: number;
  /** Game ms of the last job-board refresh. */
  jobsAt: number;
  people: Person[];
  graves: Grave[];
  feed: FeedItem[];
  nextFeedId: number;
  /** Hearth fires: building id -> game ms until which it burns. */
  fires: Record<number, number>;
  /** The last day the daily systems ran. */
  lastDay: number;
  /** Counters for the soak script and the reports. */
  stats: Record<string, number>;
  /** Newcomers still to come from the fixed pool. */
  pool: number;
  /** The act shown to the renderer for each person is derived, not stored. */
}

export type { NpcAct };
