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
import type { Dir, Look, NpcAct, NpcRole, WeatherKind } from './types';
import type { Speed } from './constants';

export const WS_PATH = '/ws';
export const LOGOUT_PATH = '/api/logout';
export const PROTOCOL_VERSION = 1;

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
}

/** What changes about an entity from one update to the next (the rest is sent once, in `view` or `add`). */
export type EntityUpdate = Pick<EntityView, 'id' | 'x' | 'y' | 'nx' | 'ny' | 'step' | 'route' | 'face' | 'state' | 'act'>;

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

/** Everything the client draws from. The sim produces it; the server adds `step` conversion to real time. */
export interface VillageView {
  time: TimeView;
  speed: Speed;
  entities: EntityView[];
  buildings: BuildingDef[];
  plots: PlotDef[];
  stock: StockSummary;
  population: number;
}

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

export type C2S =
  /** First message after connecting. */
  | { t: 'hello'; v: number }
  /** Time control: 0 pauses. */
  | { t: 'speed'; speed: Speed }
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
    }
  | { t: 'note'; level: NoteLevel; text: string }
  | { t: 'err'; code: string; text: string }
  | { t: 'pong'; n: number };

/** Close codes. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_BAD_AUTH = 4002;
export const CLOSE_RATE = 4004;
export const CLOSE_BAD_PROTOCOL = 4005;
