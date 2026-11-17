// Prix de revente observés : les offres de revendeurs (au-dessus du prix public) vues sur Auchan et Leclerc
// donnent une idée du prix auquel un produit se revend, donc de la marge si on l'achète au prix public.
import { classify, PUBLIC_PRICE_CAPS } from './classify.mjs';

const NAMES = ['nymphali', 'amphinobi', 'noctali', 'mentali', 'mewtwo', 'mew', 'metamorph', 'evoli', 'pikachu', 'rayquaza', 'dracaufeu', 'lucario'];
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Identité approximative d'un produit : cible + type (ETB, Pokébox…) + Pokémon nommé.
export function productKey(title) {
  const { targets } = classify(title);
  const target = targets.find(name => name === '30 ans' || name === 'Règne Delta');
  const type = PUBLIC_PRICE_CAPS.findIndex(([pattern]) => pattern.test(title));
  if (!target || type < 0) return null;
  const folded = fold(title);
  const name = NAMES.find(token => new RegExp(`\\b${token}\\b`).test(folded)) ?? '';
  // « Coffret » ou « figurine » sans Pokémon nommé : trop vague pour comparer des prix.
  if (!name && /coffret|collection|figurine/.test(PUBLIC_PRICE_CAPS[type][0].source)) return null;
  return `${target}|${type}|${name}`;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2 * 100) / 100;
};

// offers : offres brutes des enseignes ; previous : marché précédent (gardé 14 jours si plus d'offre visible).
export function buildMarket(offers, previous = {}, now = Date.now()) {
  const samples = {};
  for (const offer of offers) {
    if (!offer.available || !Number.isFinite(offer.price)) continue;
    const key = productKey(offer.name);
    if (!key) continue;
    const cap = PUBLIC_PRICE_CAPS[Number(key.split('|')[1])][1];
    if (offer.price <= cap || offer.price > cap * 8) continue; // prix public ou aberrant : pas un prix de revente
    (samples[key] ??= []).push(offer.price);
  }
  const at = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const market = {};
  for (const [key, value] of Object.entries(previous)) {
    if (now - Date.parse(value.updated) < 14 * 86400000) market[key] = value;
  }
  for (const [key, prices] of Object.entries(samples)) market[key] = { median: median(prices), n: prices.length, updated: at };
  return market;
}

export function withResale(signal, market) {
  const key = productKey(signal.title);
  const entry = key && market[key];
  if (!entry) return signal;
  const margin = Number.isFinite(signal.price) && signal.publicPrice !== false ? Math.round((entry.median - signal.price) * 100) / 100 : null;
  return { ...signal, resale: entry.median, resaleN: entry.n, margin };
}
