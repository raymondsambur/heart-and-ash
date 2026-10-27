/**
 * Offers (M4): decisions the village puts to the manager. A decision waits a few days; if nobody answers, or the manager is
 * away, the village does what its fallback says (what a careful keeper would do), and the report says so.
 */
import { personName } from '@hearth/shared';
import type { Ctx } from './ctx';
import { foodDaysOf } from './economy';
import { pushFeed } from './feed';
import { arrive } from './life';
import { settleOutsideOffer } from './outside';
import type { CommandResult, Offer } from './types';
import { stat } from './util';

/** Days a decision waits for an answer. */
export const OFFER_WAIT = 3;
/** Food days a village needs before the fallback takes refugees in. */
export const REFUGEE_FOOD_DAYS = 12;

const fail = (code: string, text: string): CommandResult => ({ ok: false, code, text });

export function openOffer(c: Ctx, o: Omit<Offer, 'id' | 'day' | 'expires'>): Offer {
  const offer: Offer = { ...o, id: c.st.nextOfferId++, day: c.day, expires: c.day + OFFER_WAIT };
  c.st.offers.push(offer);
  pushFeed(c.st, c.pending, 'offer', `${o.title}: ${o.text}`);
  return offer;
}

/** Refugees at the edge of the village: take them in, or send them on. */
export function refugeeOffer(c: Ctx, n: number): void {
  const fed = foodDaysOf(c) >= REFUGEE_FOOD_DAYS;
  const offer = openOffer(c, {
    kind: 'refugees',
    title: 'Refugees at the edge of the village',
    text: `${n} people came out of the hills with what they could carry and ask for shelter. The store has ${Math.round(foodDaysOf(c))} days of food.`,
    options: [
      { id: 'accept', label: 'Take them in', note: `${n} more mouths and hands. They need food and roofs.` },
      { id: 'refuse', label: 'Send them on', note: 'Nobody is hurt, and the village is a little less kind.' },
    ],
    fallback: fed ? 'accept' : 'refuse',
    n,
  });
  // While the manager is away there is nobody to ask.
  if (c.st.away) settle(c, offer, offer.fallback, true);
}

function settle(c: Ctx, offer: Offer, option: string, auto: boolean): void {
  c.st.offers = c.st.offers.filter((o) => o.id !== offer.id);
  if (auto) stat(c, 'offers_auto');
  if (offer.kind === 'refugees') {
    if (option === 'accept') {
      stat(c, 'refugees_taken', offer.n);
      pushFeed(c.st, c.pending, 'refugees', `${offer.n} refugees were taken in${auto ? ', as the village decided in your absence' : ''}.`);
      arrive(c, offer.n, [10, 55], 'refugee');
    } else {
      stat(c, 'refugees_turned_away', offer.n);
      pushFeed(c.st, c.pending, 'refugees', `${offer.n} refugees were sent on${auto ? ', as the village decided in your absence' : ''}.`);
    }
  } else settleOutsideOffer(c, offer, option);
}

export function answerOffer(c: Ctx, id: number, option: string): CommandResult {
  const offer = c.st.offers.find((o) => o.id === id);
  if (!offer) return fail('no_offer', 'That decision has already been made.');
  if (!offer.options.some((o) => o.id === option)) return fail('bad_option', 'That is not one of the choices.');
  settle(c, offer, option, false);
  return { ok: true, text: 'Decided.' };
}

/** Once a day: decisions nobody answered in time are settled by their fallback. */
export function expireOffers(c: Ctx): void {
  for (const o of [...c.st.offers]) if (c.day >= o.expires) settle(c, o, o.fallback, true);
}

/** A traveller's name, for envoys and traders (M5). */
export function strangerName(c: Ctx): string {
  return personName(c.rng);
}
