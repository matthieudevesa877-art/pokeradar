import { calendarRecord, customRaffleRecord, httpsUrl } from './domain.mjs';

export const WATCH_FRESH_MS = 6 * 60 * 60 * 1000;
const OFFER_STATES = ['available', 'invitation', 'unavailable', 'unknown'];
const CAMPAIGN_STATES = ['annoncé', 'clos', 'à vérifier', 'à surveiller', 'signalé'];

function label(value, max, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) {
    throw new Error('Texte de veille invalide.');
  }
  return value.trim();
}

function observedDate(value, now) {
  const time = Date.parse(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(value) ||
      !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value.slice(0, 10) ||
      time > now + 5 * 60 * 1000) throw new Error('Date de veille invalide.');
  return value.length === 10 ? value : new Date(time).toISOString();
}

function list(rows, max, decode) {
  if (!Array.isArray(rows) || rows.length > max) throw new Error('Liste de veille invalide.');
  const result = rows.map(decode);
  if (new Set(result.map(row => row.id)).size !== result.length) throw new Error('Entrée de veille en double.');
  return result;
}

export function decodeWatch(feed, now = Date.now()) {
  if (feed?.version !== 1) throw new Error('Format de veille inconnu.');
  return {
    version: 1,
    offers: list(feed.offers, 400, row => {
      if (!OFFER_STATES.includes(row.status) || (row.price !== null &&
        (!Number.isFinite(row.price) || row.price <= 0 || row.price > 100000))) throw new Error('Offre de veille invalide.');
      if (row.pickup !== undefined && (!Array.isArray(row.pickup) || row.pickup.length > 12)) throw new Error('Retrait invalide.');
      return {
        id: label(row.id, 160), product: label(row.product, 180), seller: label(row.seller, 100),
        url: httpsUrl(label(row.url, 2048)), price: row.price, status: row.status, observedAt: observedDate(row.observedAt, now),
        pickup: (row.pickup ?? []).map(store => label(store, 100)), details: label(row.details ?? '', 300, true)
      };
    }),
    campaigns: list(feed.campaigns, 100, row => {
      if (!CAMPAIGN_STATES.includes(row.state)) throw new Error('Tirage de veille invalide.');
      const campaign = customRaffleRecord(row);
      return {
        ...campaign, state: row.state, source: row.source ? httpsUrl(label(row.source, 2048)) : campaign.url,
        note: label(row.note ?? '', 500, true), deadlineLabel: label(row.deadlineLabel ?? '', 150, true) || undefined,
        verified: row.verified ? observedDate(row.verified, now).slice(0, 10) : '',
        releaseDate: row.releaseDate ? calendarRecord({ ...row, date: row.releaseDate, detail: row.title }).date : ''
      };
    }),
    releases: list(feed.releases, 100, calendarRecord)
  };
}

export function offerIsRecent(row, now = Date.now()) {
  if (row.observedAt.length === 10 || row.status === 'unknown') return false;
  const age = now - Date.parse(row.observedAt);
  return age >= 0 && age < WATCH_FRESH_MS;
}

export function mergeWatchEntries(baseline, updates) {
  return [...new Map([...baseline, ...updates].map(row => [row.id, row])).values()];
}

export function recentWatchStocks(offers, now = Date.now()) {
  return offers.filter(row => row.status === 'available' && offerIsRecent(row, now)).map(row => ({
    product: row.product, store: row.seller + ' · fiche marchande', state: 'Disponible signalé',
    checked: row.observedAt, url: row.url
  }));
}
