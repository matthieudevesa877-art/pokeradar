// Catalogue des produits visés, avec leur prix boutique (prix public) de référence, et grille « enseigne × produit ».
// Prix de référence : prix Amazon vendu par Amazon (relevés de novembre 2026) ou prix public annoncé ; « ≈ » si estimé.

const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// match : toutes les expressions doivent correspondre au titre (sans accents, en minuscules) ; avoid : aucune.
export const CATALOG = [
  { id: 'upc-noctali', set: '30 ans', name: 'UPC Noctali (Soirée)', price: 229.99, cap: 260, match: [/ultra[- ]?premium|\bupc\b/, /noctali|soiree/] },
  { id: 'upc-mentali', set: '30 ans', name: 'UPC Mentali (Journée)', price: 229.99, cap: 260, match: [/ultra[- ]?premium|\bupc\b/, /mentali|journee/] },
  { id: 'etb-30', set: '30 ans', name: 'ETB 30 ans', price: 55.99, cap: 70, match: [/dresseur d.elite|\betb\b/, /30|anniv/], avoid: [/delta|mega/] },
  { id: 'metamorph', set: '30 ans', name: 'Collection Premium Métamorph', price: 54.99, cap: 65, match: [/metamorph/] },
  { id: 'classeur-30', set: '30 ans', name: 'Coffret Classeur 30 ans', price: 49.99, cap: 60, match: [/classeur/, /30|anniv/] },
  { id: 'mew', set: '30 ans', name: 'Collection figurine Mew', price: 39.99, cap: 50, match: [/\bmew\b/, /collection|coffret/] },
  { id: 'mewtwo', set: '30 ans', name: 'Collection figurine Mewtwo', price: 39.99, cap: 50, match: [/mewtwo/, /collection|coffret/] },
  { id: 'bundle-30', set: '30 ans', name: 'Bundle 6 boosters 30 ans', price: 35.94, cap: 45, match: [/bundle|lot de 6|6 boosters/, /30|anniv/], avoid: [/delta|mega/] },
  { id: 'nymphali', set: '30 ans', name: 'Pokébox / coffret Nymphali-ex', price: 26.99, cap: 35, match: [/nymphali/], avoid: [/premium|ultra|upc|figurine|mega-/] },
  { id: 'amphinobi', set: '30 ans', name: 'Pokébox / coffret Amphinobi-ex', price: 25.9, cap: 35, match: [/amphinobi/], avoid: [/premium|ultra|upc|figurine|mega-/] },
  { id: 'poster-30', set: '30 ans', name: 'Collection Poster 30 ans', price: 25.99, cap: 38, match: [/poster/, /30|anniv|sulfura|artikodin|electhor/] },
  { id: 'tripack-30', set: '30 ans', name: 'Tripack 30 ans', price: 20.99, cap: 25, match: [/tri\s?pack|3 boosters/, /30|anniv/], avoid: [/delta|mega/] },
  { id: 'etb-delta', set: 'Règne Delta', name: 'ETB Règne Delta', price: 59.99, approx: true, cap: 70, match: [/dresseur d.elite|\betb\b/, /regne delta/] },
  { id: 'display-delta', set: 'Règne Delta', name: 'Display 36 boosters Règne Delta', price: 215, approx: true, cap: 230, match: [/display|presentoir|36 boosters/, /regne delta/] },
  { id: 'bundle-delta', set: 'Règne Delta', name: 'Bundle 6 boosters Règne Delta', price: 39.99, approx: true, cap: 45, match: [/bundle|lot de 6|6 boosters/, /regne delta/] },
  { id: 'tripack-delta', set: 'Règne Delta', name: 'Tripack Règne Delta', price: 21.9, approx: true, cap: 25, match: [/tri\s?pack|3 boosters/, /regne delta/] }
];

export function catalogMatch(title) {
  const text = fold(title);
  // Produit dérivé (jouet, textile…) : jamais. Sinon il faut du vocabulaire de cartes à collectionner.
  if (/peluche|lego|jazwares|paillettes|figurine de combat|epic battle|select|articul|funko|puzzle|t-?shirt|switch|ceinture|clip.?n.?go|parure|housse|taie|couette|sac|cartable|trousse|gourde|lampe|veilleuse|montre|mug|pyjama|costume|deguisement|poke ?ball/.test(text)) return null;
  if (!/carte|booster|jcc|tcg|coffret|collection|pok.?box|etb|dresseur|display|presentoir|bundle|tri ?pack|upc|ultra[- ]?premium|classeur|poster|blister/.test(text)) return null;
  return CATALOG.find(product => product.match.every(pattern => pattern.test(text)) && !(product.avoid ?? []).some(pattern => pattern.test(text))) ?? null;
}

// offers : offres brutes lues sur les sites (Auchan, Leclerc). Pour chaque produit et enseigne :
// « boutique » = en stock au prix boutique ; « revendeurs » = seulement au-dessus ; « absent » = rien vu.
export function buildGrid(offers, now = Date.now(), retailers = ['Auchan', 'E.Leclerc']) {
  const at = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const grid = {};
  for (const product of CATALOG) {
    grid[product.id] = {};
    for (const retailer of retailers) {
      const matches = offers.filter(offer => offer.retailer === retailer && offer.available && Number.isFinite(offer.price) &&
        offer.price <= product.price * 8 && catalogMatch(offer.name)?.id === product.id); // au-delà de 8× : lot ou erreur
      const shop = matches.filter(offer => offer.price <= product.cap).sort((a, b) => a.price - b.price)[0];
      const resale = matches.filter(offer => offer.price > product.cap).sort((a, b) => a.price - b.price)[0];
      grid[product.id][retailer] = shop
        ? { state: 'boutique', price: shop.price, url: shop.url, seller: shop.seller, at }
        : resale ? { state: 'revendeurs', price: resale.price, url: resale.url, seller: resale.seller, at } : { state: 'absent', at };
    }
  }
  return grid;
}
