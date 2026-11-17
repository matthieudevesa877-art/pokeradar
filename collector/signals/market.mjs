// Analyse de prix : chaque signal est comparé au prix boutique de référence du produit (catalogue),
// et au prix de revente observé (offres de revendeurs vues sur Auchan et Leclerc) pour estimer la marge.
import { catalogMatch, CATALOG } from './catalog.mjs';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2 * 100) / 100;
};
const round = value => Math.round(value * 100) / 100;

// Prix de revente par produit du catalogue : médiane des offres au-dessus du prix boutique (aberrations exclues).
// previous : marché précédent, gardé 14 jours quand plus aucune offre n'est visible.
export function buildMarket(offers, previous = {}, now = Date.now()) {
  const samples = {};
  for (const offer of offers) {
    if (!offer.available || !Number.isFinite(offer.price)) continue;
    const product = catalogMatch(offer.name);
    if (!product || offer.price <= product.cap || offer.price > product.price * 8) continue;
    (samples[product.id] ??= []).push(offer.price);
  }
  const at = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const market = {};
  for (const [id, value] of Object.entries(previous ?? {})) {
    if (CATALOG.some(product => product.id === id) && now - Date.parse(value.updated) < 14 * 86400000) market[id] = value;
  }
  for (const [id, prices] of Object.entries(samples)) {
    market[id] = { median: median(prices), min: Math.min(...prices), n: prices.length, updated: at };
  }
  return market;
}

const PREORDER = /pr[ée][- ]?commande|pr[ée]vente|pre-?order/i;

// Ajoute au signal : produit reconnu, prix boutique de référence, verdict, revente et marge, « bonne affaire ».
export function analyze(signal, market = {}) {
  const product = catalogMatch(signal.title);
  const preorder = PREORDER.test(signal.title);
  const out = { ...signal, preorder, catalogId: product?.id ?? null, refPrice: product?.price ?? null, refApprox: Boolean(product?.approx) };
  const price = Number.isFinite(signal.price) ? signal.price : null;
  if (product && price !== null) out.publicPrice = price <= product.cap;
  out.verdict = price === null ? (signal.kind === 'magasin' ? 'à vérifier' : null) : out.publicPrice === true ? 'prix boutique' : out.publicPrice === false ? 'revente' : null;
  const resale = product && market[product.id];
  if (resale) {
    out.resale = resale.median;
    out.resaleN = resale.n;
    const buy = out.verdict === 'prix boutique' ? price : out.verdict === 'à vérifier' ? product.price : null;
    out.margin = buy === null ? null : round(resale.median - buy);
  } else {
    delete out.resale; delete out.resaleN; out.margin = null;
  }
  // Bonne affaire : grande enseigne, cartes, pas une précommande, au prix boutique (ou repéré en magasin, prix à vérifier).
  out.deal = Boolean(signal.tcg && signal.big && !preorder && (out.verdict === 'prix boutique' || out.verdict === 'à vérifier'));
  return out;
}
