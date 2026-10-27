/**
 * Network contract between the browser client and the game server.
 *
 * - HTTP (JSON) for accounts and the static map (`GET /api/world`).
 * - One WebSocket at /ws (cookie-authenticated). The client sends `C2S`, the server sends `S2C`.
 *
 * The server is authoritative. The client only asks (change speed, later orders); the server validates everything.
 * Keep this file additive: add fields and messages, avoid renaming.
 */
import type { BuildingDef, PlotDef } from './terrain';
import type { CarryKind, Dir, Look, NpcAct, NpcRole, WeatherKind } from './types';
import type { NeedId } from './data/needs';
import type { BuildKind } from './data/blueprints';
import type { JobGroup, OutsideView, PolicyView, ReportView, RuleDef } from './data/policy';
import type { FloraTile, GroundTile } from './data/flora';
import type { Speed } from './constants';

export const WS_PATH = '/ws';
export const LOGOUT_PATH = '/api/logout';
export const PROTOCOL_VERSION = 6;

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

/** POST /api/register, POST /api/login */
export interface AuthRequest {
  username: string;
  password: string;
}

/** Shared envelope for HTTP errors: status 4xx with this body. */
export interface ApiError {
  error: string;
}

export interface VillageBrief {
  name: string;
  seed: number;
}

/** GET /api/me (401 when logged out), also returned by login and register. */
export interface MeResponse {
  user: { id: number; username: string };
  /** The account's village; created on first login, so this is set once an account exists. */
  village: VillageBrief;
}

/** GET /api/world: the static map, sent once per session. Grids are base64. */
export interface WorldPayload {
  seed: number;
  w: number;
  h: number;
  terrain: string;
  objects: string;
  blight: string;
  /** The village green: orders are accepted within a radius of it. */
  center: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// The village as the client sees it
// ---------------------------------------------------------------------------

export type EntityState = 'idle' | 'walk' | 'work' | 'rest';

export interface EntityView {
  id: number;
  name: string;
  /** Tile the entity stands on. */
  x: number;
  y: number;
  /** Next tile and the duration (game ms) of the step in progress; omitted when standing still. */
  nx?: number;
  ny?: number;
  step?: number;
  /** Up to a few tiles after (nx, ny), flat [x, y, x, y ...], so a fast clock keeps walking between updates. */
  route?: number[];
  face: Dir;
  state: EntityState;
  look: Look;
  role?: NpcRole;
  /** What they are doing while they stand still; the renderer plays a matching animation. */
  act?: NpcAct;
  /** Something heavy in their hands (for the hauling pose). */
  carry?: CarryKind;
  /** Indoors (not drawn). */
  hidden?: true;
  /** A child (drawn smaller). */
  child?: true;
}

/** What changes about an entity from one update to the next (the rest is sent once, in `view` or `add`). */
export type EntityUpdate = Pick<EntityView, 'id' | 'x' | 'y' | 'nx' | 'ny' | 'step' | 'route' | 'face' | 'state' | 'act' | 'carry' | 'hidden'>;

export interface TimeView {
  /** Hour of the day, 0 up to 24. */
  hours: number;
  /** Absolute day count since the village began (day 0 is the first). */
  day: number;
  /** Day inside the season, 1 based. */
  dayOfSeason: number;
  /** 0 Spring, 1 Summer, 2 Autumn, 3 Winter. */
  season: number;
  /** 0 based. */
  year: number;
  weather: WeatherKind;
  /** Real milliseconds per game hour at 1x, so the client can extrapolate the clock between updates. */
  hourMs: number;
}

/** Goods in the village stockpile, summarised (M3 fills this with a real economy). */
export type StockSummary = Record<string, number>;

/** A line of the events feed. */
export interface FeedEntry {
  id: number;
  day: number;
  hour: number;
  kind: string;
  text: string;
  people: number[];
}

/** One row of the villager list. */
export interface PersonBrief {
  id: number;
  name: string;
  age: number;
  sex: 0 | 1;
  /** What they are mostly known for ("Farmer", "Child", "Elder"). */
  title: string;
  /** What they are doing now, in words ("chopping wood"). */
  doing: string;
  mood: number;
  /** Their lowest need and its value. */
  lowest: { need: NeedId; v: number };
  /** Short flags: `ill`, `pregnant`, `stuck`. */
  flags: string[];
}

export interface SheetNeed {
  id: NeedId;
  label: string;
  value: number;
  /** Plain-words state ("hungry"), set when the need is low. */
  state?: string;
}

export interface SheetRelation {
  id: number;
  name: string;
  /** `partner`, `parent`, `child`, `sibling`, `friend`, `rival`, `acquaintance`, `sweetheart`. */
  kind: string;
  aff: number;
  fam: number;
  rom: number;
}

export interface SheetAmbition {
  label: string;
  text: string;
  progress: number;
  stuck?: string;
  /** `fulfilled` or `abandoned`, with the reason, when it has ended. */
  ended?: string;
}

/** Everything the villager sheet shows. */
export interface PersonSheet {
  id: number;
  name: string;
  age: number;
  sex: 0 | 1;
  look: Look;
  title: string;
  home: string;
  needs: SheetNeed[];
  /** The lowest need in a sentence: "Hungry: nothing to eat in the store". */
  needNote: string;
  mood: number;
  moodWord: string;
  moodCauses: { text: string; v: number }[];
  hp: number;
  maxHp: number;
  ills: string[];
  skills: { id: string; label: string; lv: number; pct: number }[];
  traits: { id: string; label: string; desc: string }[];
  ambitions: SheetAmbition[];
  relations: SheetRelation[];
  loyalty: number;
  doing: string;
  /** Why: the goal and where it came from, the runners-up, the plan, and what blocks it. */
  why: { goal: string; source: string; top: { label: string; source: string; score: number }[]; plan: string; blocked?: string };
  memories: { text: string; day: number; val: number }[];
  carrying: string;
  silver: number;
  tools: number;
}

/** A build or demolish order, as the order list shows it. */
export interface OrderView {
  id: number;
  mode: 'build' | 'demolish' | 'rubble';
  kind: BuildKind;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
  /** The building or plot it is about. */
  building?: number;
  plot?: number;
  /** Finished stages and the stages in all (building: `stages` stands for the finished building). */
  done: number;
  stages: number;
  /** 0..100 over the whole job. */
  overall: number;
  /** Why it is not moving, in words ("waiting for 12 planks"). */
  waiting?: string;
  /** Materials the whole build needs, and how many have reached the plot. */
  needs: { good: string; have: number; need: number }[];
  /** Villagers on the job board's claim for it right now. */
  workers: number;
  day: number;
  /** "you" for the manager, or the villager's name when they started it. */
  by: string;
}

/** Someone who wants something built and says so (own house, a shrine), until it is. */
export interface WishView {
  who: number;
  name: string;
  wish: string;
  day: number;
}

/** How the village is doing for the things that kill it: food, fuel, the Blight and what is coming (M3). */
export interface VillageStatus {
  /** Days the store's food lasts at the present population and the present rationing. */
  foodDays: number;
  /** Days of winter heating the wood in the store would cover (99 when there is no need). */
  fuelDays: number;
  /** 0 normal, 1 tight, 2 strict. */
  rationing: 0 | 1 | 2;
  /** 0 hamlet, 1 village, 2 town (M5), and the village's silver. */
  tier: 0 | 1 | 2;
  silver: number;
  /** Tiles of Blight that reach the village once the shrines' ward is taken off. */
  blight: number;
  /** Something the manager should look at now: raiders are expected (`raid`) or sickness is in the village (`plague`). */
  alert: 'raid' | 'plague' | null;
}

/** Everything the client draws from. The sim produces it; the server adds `step` conversion to real time. */
export interface VillageView {
  time: TimeView;
  speed: Speed;
  entities: EntityView[];
  buildings: BuildingDef[];
  plots: PlotDef[];
  stock: StockSummary;
  population: number;
  roster: PersonBrief[];
  /** The latest feed lines, oldest first. */
  feed: FeedEntry[];
  /** Build and demolish orders in progress, oldest first. */
  orders: OrderView[];
  wishes: WishView[];
  status: VillageStatus;
  /** Priorities, rules, offers waiting for an answer, and whether the village is running without the manager (M4). */
  policy: PolicyView;
  /** The latest reports, newest last. */
  reports: ReportView[];
  /** The town beyond the map (M5). */
  outside: OutsideView;
  /** Trees cut and bushes picked: where the ground differs from the map (M6). */
  flora: FloraTile[];
  /** Tiles whose ground differs from the map: roads worn by feet and grass where a road was (M6). */
  ground: GroundTile[];
}

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

export type C2S =
  /** First message after connecting. */
  | { t: 'hello'; v: number }
  /** Time control: 0 pauses. */
  | { t: 'speed'; speed: Speed }
  /** Watch one villager: the server then sends their sheet about once a second. `null` stops watching. */
  | { t: 'inspect'; id: number | null }
  /** Order a building raised (or a field ploughed) with its top-left corner at (x, y). A wall can be laid the other way (`rot`). */
  | { t: 'build'; kind: BuildKind; x: number; y: number; rot?: boolean }
  /** Order a building (or a field) taken down. */
  | { t: 'demolish'; building?: number; plot?: number }
  /** Cancel an order. Work that has begun is turned into a demolition. */
  | { t: 'cancel'; order: number }
  /** How much of a portion each person is given: 0 normal, 1 tight, 2 strict. */
  | { t: 'ration'; level: 0 | 1 | 2 }
  /** Set how much of the village's labour goes to a kind of work (0 off to 4 urgent). */
  | { t: 'priority'; group: JobGroup; level: number }
  /** Add a standing rule (`id` 0) or change one. */
  | { t: 'rule'; rule: RuleDef }
  | { t: 'rule_del'; id: number }
  /** Answer a decision the village asked for. */
  | { t: 'answer'; offer: number; option: string }
  /** Mark a report as read. */
  | { t: 'read'; report: number }
  | { t: 'ping'; n: number };

export type NoteLevel = 'info' | 'good' | 'warn' | 'bad';

export type S2C =
  | { t: 'welcome'; v: number; user: { id: number; username: string }; village: VillageBrief }
  /** The whole village, sent right after `welcome`. */
  | { t: 'view'; view: VillageView }
  /**
   * About five times a second. `ents` holds the state of every entity the client knows; `add` and `del` are present only
   * when people arrive or leave; `buildings`, `plots` and `stock` only when they changed.
   */
  | {
      t: 'upd';
      time: TimeView;
      speed: Speed;
      population: number;
      ents: EntityUpdate[];
      add?: EntityView[];
      del?: number[];
      buildings?: BuildingDef[];
      plots?: PlotDef[];
      stock?: StockSummary;
      /** Food, fuel, rationing and alerts, when they changed. */
      status?: VillageStatus;
      /** Priorities, rules and offers, and the reports, when they changed. */
      policy?: PolicyView;
      reports?: ReportView[];
      outside?: OutsideView;
      flora?: FloraTile[];
      ground?: GroundTile[];
      /** The villager list, when it changed (a few times a minute at most). */
      roster?: PersonBrief[];
      /** The order list and the wishes, when they changed. */
      orders?: OrderView[];
      wishes?: WishView[];
    }
  /** New feed lines. */
  | { t: 'feed'; items: FeedEntry[] }
  /** The sheet of the watched villager (`null` when they are gone). */
  | { t: 'sheet'; sheet: PersonSheet | null }
  | { t: 'note'; level: NoteLevel; text: string }
  | { t: 'err'; code: string; text: string }
  | { t: 'pong'; n: number };

/** Close codes. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_BAD_AUTH = 4002;
export const CLOSE_RATE = 4004;
export const CLOSE_BAD_PROTOCOL = 4005;
