// Lecture d'une fiche marchande -> { status, price, pickup?, details? }.
// Règle de fiabilité : un adaptateur ne répond « unavailable » que s'il a VU un marqueur de rupture.
// Quand la page est ambiguë, il lève une CheckError('parse') et l'ancienne observation est conservée.

export class CheckError extends Error {
  constructor(kind, message, http) {
    super(message);
    this.kind = kind; // blocked | http | network | timeout | parse
    this.http = http;
  }
}

const AVAILABILITY = {
  InStock: 'available', LimitedAvailability: 'available', OnlineOnly: 'available', InStoreOnly: 'available',
  PreOrder: 'available', PreSale: 'available',
  OutOfStock: 'unavailable', SoldOut: 'unavailable', Discontinued: 'unavailable', BackOrder: 'unavailable'
};

export function toPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/&nbsp;| | |\s|€|&euro;/g, '').replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) && number > 0 && number < 100000 ? Math.round(number * 100) / 100 : null;
}

export function availabilityOf(value) {
  if (typeof value !== 'string') return null;
  return AVAILABILITY[value.replace(/^.*[/#]/, '')] ?? null;
}

export function jsonLdProduct(html) {
  const nodes = [];
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(match[1].trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === 'object') {
        nodes.push(node);
        if (node['@graph']) stack.push(node['@graph']);
      }
    }
  }
  const product = nodes.find(node => [].concat(node['@type']).includes('Product') && node.offers);
  if (!product) return null;
  const offers = [].concat(product.offers).flatMap(offer => offer?.offers ? [].concat(offer.offers) : [offer]).filter(Boolean);
  const statuses = offers.map(offer => availabilityOf(offer.availability)).filter(Boolean);
  const prices = offers.map(offer => toPrice(offer.price ?? offer.lowPrice)).filter(Boolean);
  return {
    name: typeof product.name === 'string' ? product.name : '',
    status: statuses.includes('available') ? 'available' : statuses[0] ?? null,
    price: prices.length ? Math.min(...prices) : null,
    description: typeof product.description === 'string' ? product.description : ''
  };
}

export function parseGeneric(html) {
  const product = jsonLdProduct(html);
  if (!product?.status) throw new CheckError('parse', 'Aucune donnée produit (JSON-LD) exploitable.');
  return { status: product.status, price: product.price };
}

export function parseLeCoinDesBarons(html) {
  const product = jsonLdProduct(html);
  const cls = /class="stock\s+([a-z-]+)"/.exec(html)?.[1];
  const fromClass = cls === 'in-stock' ? 'available' : cls === 'out-of-stock' ? 'unavailable' : cls === 'available-on-backorder' ? 'available' : null;
  const status = product?.status ?? fromClass;
  if (!status) throw new CheckError('parse', 'Ni JSON-LD ni classe de stock WooCommerce.');
  if (product?.status && fromClass && product.status !== fromClass) {
    throw new CheckError('parse', `Contradiction : JSON-LD ${product.status}, page ${fromClass}.`);
  }
  const priceBlock = /<p class="price">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
  const price = product?.price ?? toPrice(/product:price:amount"\s+content="([^"]+)"/.exec(html)?.[1])
    ?? toPrice(/<ins[^>]*>([\s\S]*?)<\/ins>/.exec(priceBlock)?.[1]?.replace(/<[^>]+>/g, '') ?? priceBlock.replace(/<[^>]+>/g, ''));
  return { status, price };
}

export function parseUltraJeux(html) {
  const start = html.search(/itemprop="availability"/i);
  if (start < 0) throw new CheckError('parse', 'Marqueur de disponibilité UltraJeux introuvable.');
  const end = html.indexOf('Editeur', start);
  const block = html.slice(Math.max(0, start - 600), end > start ? end : start + 6000);
  const status = availabilityOf(/itemprop="availability"\s+content="([^"]+)"/i.exec(block)?.[1]);
  if (!status) throw new CheckError('parse', 'Disponibilité UltraJeux illisible.');
  const price = toPrice(/itemprop="price"\s+content="([^"]+)"/i.exec(block)?.[1]) ?? toPrice(/class="prix">([^<]+)</.exec(block)?.[1]);
  const pickup = [...block.matchAll(/<span style="font-size: 15px;">([^<:]+?)\s*:\s*<span[^>]*>\s*(Disponible|Indisponible)\s*<\/span>/gi)]
    .filter(match => match[2].toLowerCase() === 'disponible')
    .map(match => match[1].replace(/^Paris\s+/i, '').trim());
  return { status, price, pickup };
}

export function parseVariantes(html) {
  const product = jsonLdProduct(html);
  if (!product?.status) throw new CheckError('parse', 'JSON-LD Variantes illisible.');
  const result = { status: product.status, price: product.price };
  if (/CLICK AND COLLECT/i.test(product.description)) result.details = 'Retrait uniquement';
  return result;
}

export function parseShopifyJs(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new CheckError('parse', 'Réponse Shopify non JSON.'); }
  if (typeof data?.available !== 'boolean') throw new CheckError('parse', 'Champ available absent.');
  const cents = Number(data.price);
  return { status: data.available ? 'available' : 'unavailable', price: Number.isFinite(cents) ? toPrice(cents / 100) : null };
}

export function parseAmazon(html) {
  if (html.length < 40000 && /captcha|api-services-support@amazon|Saisissez les caractères/i.test(html)) {
    throw new CheckError('blocked', 'Amazon demande une vérification anti-robot.');
  }
  const price = toPrice(/class="a-offscreen">\s*([\d\s.,  ]+)(?:&nbsp;| |\s)*€/.exec(html)?.[1]);
  if (/Demander une invitation/i.test(html)) return { status: 'invitation', price };
  const hasCart = /<input[^>]+id="add-to-cart-button"/i.test(html);
  const merchant = /id="merchant-info"[^>]*>([\s\S]{0,600}?)<\/(?:div|span)>\s*<\/(?:div|span)>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') ?? '';
  const soldByAmazon = /Vendu par\s*(?:<[^>]+>\s*)*Amazon/i.test(html) || /^\s*Amazon(\.fr)?\s*$/i.test(merchant) || /Expédié par\s*Amazon/i.test(merchant) && /Vendu par\s*Amazon/i.test(merchant);
  if (hasCart && soldByAmazon) return { status: 'available', price };
  if (/Actuellement indisponible/i.test(html) && !hasCart) return { status: 'unavailable', price };
  throw new CheckError('parse', 'Fiche Amazon ambiguë (vendeur tiers, achat impossible à confirmer).');
}

// host -> { parse(body), mode: 'html' | 'text', url(u)?, gapMs }
export const ADAPTERS = {
  'www.amazon.fr': { name: 'amazon', parse: parseAmazon, gapMs: 7000 },
  'lecoindesbarons.com': { name: 'woocommerce', parse: parseLeCoinDesBarons, gapMs: 2500 },
  'www.ultrajeux.com': { name: 'ultrajeux', parse: parseUltraJeux, gapMs: 2500 },
  'www.variantes.com': { name: 'variantes', parse: parseVariantes, gapMs: 2500 },
  'zawarudo.be': { name: 'shopify', parse: parseShopifyJs, gapMs: 4000, requestUrl: url => url.split('?')[0].replace(/\/$/, '') + '.js' }
};

export function adapterFor(url) {
  const host = new URL(url).hostname;
  return { host, ...(ADAPTERS[host] ?? { name: 'jsonld', parse: parseGeneric, gapMs: 3000 }) };
}
