/** The events feed: births, marriages, quarrels, ambitions, arrivals, departures, deaths. */
import { clockOf } from './calendar';
import type { FeedItem, SimEvent, SimState } from './types';

export const FEED_KEEP = 200;

export function pushFeed(st: SimState, pending: SimEvent[], kind: string, text: string, people: number[] = []): FeedItem {
  const c = clockOf(st.totalMs);
  const item: FeedItem = { id: st.nextFeedId++, day: c.day, hour: Math.floor(c.hours), kind, text, people };
  st.feed.push(item);
  if (st.feed.length > FEED_KEEP) st.feed.splice(0, st.feed.length - FEED_KEEP);
  pending.push({ t: 'feed', item });
  return item;
}

