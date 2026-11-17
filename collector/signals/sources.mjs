// Sources publiques de signalements : lecture + transformation en « signaux » classés.
// Chaque parseur est pur (texte -> liste) pour être testé sans réseau.
//
// Écartées après essai (novembre 2026) : X/Twitter (le fil public renvoie un vieux cache et bloque après
// 1 à 2 lectures, l'API est payante), Fnac, Cultura, King Jouet, Carrefour, Micromania, Smyths,
// Intermarché, Pokémon Center (protections anti-robot), commentaires Dealabs (chargés par API interne).
import { classify, isPublicPrice } from './classify.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', hellip: '…', euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
export function decodeEntities(text = '') {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}
export function plain(html = '') {
  return decodeEntities(html.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const tag = (xml, name) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};
const iso = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z') : null; };
export const priceOf = text => {
  const match = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|eur\b)/i.exec(text);
  return match ? Number(match[1].replace(',', '.')) : null;
};

export function signal({ id, at, source, title, text = '', url, retailerHint = '', price = null }) {
  const body = `${title}\n${text}`.slice(0, 2000);
  const info = classify(`${retailerHint} ${body}`);
  const finalPrice = price ?? priceOf(body);
  return {
    id, at, source, title: title.slice(0, 200), text: text.slice(0, 400), url,
    price: finalPrice, publicPrice: isPublicPrice(title, finalPrice), ...info, retailer: retailerHint || info.retailer,
    big: info.big || ['E.Leclerc', 'Auchan', 'Carrefour', 'Cultura', 'Fnac', 'Micromania', 'King Jouet', 'Amazon', 'Smyths', 'JouéClub', 'La Grande Récré', 'Cdiscount', 'Lidl', 'Action', 'Monoprix'].includes(retailerHint)
  };
}

// ——— Dealabs (flux RSS public du groupe Pokémon) ———
export function parseDealabs(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const link = tag(item, 'link');
    const merchant = /<pepper:merchant name="([^"]*)"(?: price="([^"]*)")?/.exec(item);
    const title = plain(tag(item, 'title'));
    const description = plain(tag(item, 'description'));
    const at = iso(tag(item, 'pubDate'));
    const threadId = /-(\d+)(?:[?#]|$)/.exec(link)?.[1] ?? link;
    if (!at || !link) return null;
    const retailer = merchant ? decodeEntities(merchant[1]).replace(/^E\.Leclerc$/i, 'E.Leclerc') : '';
    return signal({
      id: `dealabs:${threadId}`, at, source: 'Dealabs', title, text: description.split('Historique des deals')[0].trim(),
      url: link, retailerHint: retailer, price: merchant?.[2] ? priceOf(decodeEntities(merchant[2])) : null
    });
  }).filter(Boolean);
}

// ——— Restock Collector (flux RSS public, boutiques au prix public) ———
export function parseRestockCollector(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const title = plain(tag(item, 'title'));
    const at = iso(tag(item, 'pubDate'));
    const guid = tag(item, 'guid');
    const shop = /\bchez (.+?) à [\d,.]+\s?€/.exec(title)?.[1] ?? '';
    if (!at || !guid) return null;
    return signal({ id: `rc:${guid}`, at, source: 'Restock Collector', title, url: tag(item, 'link'), retailerHint: shop });
  }).filter(Boolean);
}

// ——— Pages de recherche publiques des enseignes : offres (enseigne ou marketplace) ———
// Renvoie des « offres » brutes ; run.mjs n'en fait un signal que si elle est au prix public.
export function parseAuchanSearch(html) {
  return html.split('<article').slice(1).map(card => {
    const href = /href="(\/[^"]*\/pr-[^"]+)"/.exec(card)?.[1];
    const name = plain(/product-thumbnail__description[^>]*>([\s\S]*?)<\/(?:p|div|span|h\d)>/.exec(card)?.[1] ?? /title="([^"]+)"/.exec(card)?.[1] ?? '');
    const price = Number(/itemprop="price" content="([\d.]+)"/.exec(card)?.[1]);
    const availability = /itemprop="availability" content="[^"]*\/(\w+)"/.exec(card)?.[1] ?? '';
    const seller = plain(/marketplace-label-link">([^<]+)</.exec(card)?.[1] ?? '') || 'Auchan';
    if (!href || !name) return null;
    return { retailer: 'Auchan', name: name.replace(/s+/g, ' '), url: `https://www.auchan.fr${href.split('?')[0]}`, price: Number.isFinite(price) ? price : null, available: availability === 'InStock', seller };
  }).filter(Boolean);
}

export function parseLeclercSearch(html) {
  return html.split('<article').slice(1).filter(card => card.includes('data-product-card')).map(card => {
    const href = /href="(\/fp\/[^"]+)"/.exec(card)?.[1];
    const name = decodeEntities(/data-product-card-title title="([^"]+)"/.exec(card)?.[1] ?? '');
    const euros = /<p aria-hidden="true"[^>]*><span[^>]*>(\d+)<\/span>/.exec(card)?.[1];
    const cents = /,<\/span><\/span>\s*<span[^>]*>(\d{2})<\/span>/.exec(card)?.[1] ?? '00';
    const seller = plain(/Vendu par\s*(?:<[^>]+>\s*)*([^<]{2,60})</.exec(card)?.[1] ?? '') || '';
    if (!href || !name) return null;
    return { retailer: 'E.Leclerc', name, url: `https://www.e.leclerc${href.split('?')[0]}`, price: euros ? Number(`${euros}.${cents}`) : null, available: true, seller };
  }).filter(Boolean);
}

// Recherches ciblées sur le catalogue (catalog.mjs) : 6 par enseigne et par passage.
const QUERIES = ['pokemon 30e anniversaire', 'pokemon regne delta', 'pokemon coffret dresseur elite', 'pokemon collection ultra premium', 'pokemon metamorph', 'pokemon mewtwo'];

export const SOURCES = [
  { name: 'Dealabs', url: 'https://www.dealabs.com/rss/groupe/pokemon', parse: parseDealabs },
  { name: 'Restock Collector', url: 'https://restock-collector.com/feed/restocks/?jeu=pokemon', parse: parseRestockCollector },
  ...QUERIES.map(query => ({ name: `Auchan « ${query} »`, url: `https://www.auchan.fr/recherche?text=${encodeURIComponent(query)}`, offers: parseAuchanSearch })),
  ...QUERIES.map(query => ({ name: `Leclerc « ${query} »`, url: `https://www.e.leclerc/recherche?q=${encodeURIComponent(query)}`, offers: parseLeclercSearch }))
];
