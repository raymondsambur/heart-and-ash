/**
 * The client's central state: what the server last told us about the village, and the connection. Small on purpose,
 * the client holds no game rules. `subscribe(keys, fn)` is the only way UI parts learn about changes.
 */
import type { BuildKind, BuildingDef, FeedEntry, MeResponse, OrderView, PersonBrief, PersonSheet, PlotDef, Speed, StockSummary, TimeView, VillageBrief, WishView } from '@hearth/shared';
import type { ConnInfo } from '../net/socket';

/** What the pointer does on the map: nothing, lay out a building, or pick something to take down. */
/** A finished or half-built structure the player has pointed at. */
export interface Focus {
  building?: number;
  plot?: number;
}

export type MapTool = { t: 'build'; kind: BuildKind; rot: boolean } | { t: 'demolish' } | null;

export interface State {
  me: MeResponse | null;
  village: VillageBrief | null;
  time: TimeView | null;
  speed: Speed;
  population: number;
  stock: StockSummary;
  buildings: BuildingDef[];
  plots: PlotDef[];
  /** The villager list, the events feed (oldest first), the selected villager, their sheet, and whether the camera follows them. */
  roster: PersonBrief[];
  feed: FeedEntry[];
  selected: number | null;
  sheet: PersonSheet | null;
  follow: boolean;
  /** Build and demolish orders in hand, what villagers wish for, and the map tool in use. */
  orders: OrderView[];
  wishes: WishView[];
  tool: MapTool;
  /** The building or field the player last tapped (its progress and the way to take it down show in the build panel). */
  focus: Focus | null;
  conn: ConnInfo;
  /** Round-trip time to the server in ms, or null before the first answer. */
  latency: number | null;
}

export type StateKey = keyof State;

export function initialState(): State {
  return {
    me: null,
    village: null,
    time: null,
    speed: 1,
    population: 0,
    stock: {},
    buildings: [],
    plots: [],
    roster: [],
    feed: [],
    selected: null,
    sheet: null,
    follow: false,
    orders: [],
    wishes: [],
    tool: null,
    focus: null,
    conn: { state: 'idle', attempt: 0 },
    latency: null,
  };
}

export class Store {
  private s: State = initialState();
  private subs = new Set<{ keys: ReadonlySet<StateKey> | null; fn: () => void }>();

  get<K extends StateKey>(key: K): State[K] {
    return this.s[key];
  }

  /** Set one key. Subscribers run only when the value is not identical to the old one. */
  set<K extends StateKey>(key: K, value: State[K]): void {
    if (Object.is(this.s[key], value)) return;
    this.s[key] = value;
    this.notify(key);
  }

  /** Set several keys at once; each subscriber runs at most once. */
  patch(patch: Partial<State>): void {
    const changed: StateKey[] = [];
    for (const k of Object.keys(patch) as StateKey[]) {
      if (Object.is(this.s[k], patch[k])) continue;
      (this.s as unknown as Record<string, unknown>)[k] = patch[k];
      changed.push(k);
    }
    if (changed.length) this.notify(...changed);
  }

  /** Call `fn` when any of `keys` changes (all keys when omitted). Returns the unsubscribe function. */
  subscribe(keys: StateKey | StateKey[] | null, fn: () => void): () => void {
    const entry = { keys: keys === null ? null : new Set(Array.isArray(keys) ? keys : [keys]), fn };
    this.subs.add(entry);
    return () => this.subs.delete(entry);
  }

  /** Back to the empty state (logout). Subscribers are told about every key. */
  reset(): void {
    this.s = initialState();
    this.notify(...(Object.keys(this.s) as StateKey[]));
  }

  private notify(...changed: StateKey[]): void {
    for (const sub of [...this.subs]) {
      if (sub.keys === null || changed.some((k) => sub.keys!.has(k))) sub.fn();
    }
  }
}
