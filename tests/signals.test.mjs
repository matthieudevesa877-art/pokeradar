import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, isImportant, isPublicPrice, placeOf, publicPriceCap, retailerOf, targetsOf } from '../collector/signals/classify.mjs';
import { parseAuchanSearch, parseDealabs, parseLeclercSearch, parseRestockCollector } from '../collector/signals/sources.mjs';
import { patterns, slotOf } from '../collector/signals/patterns.mjs';
import { mergeSignalFiles, mergeSignals, offerIsGood, signalsFromEvents, signalsFromOffers } from '../collector/signals/run.mjs';

test('enseigne, lieu en Île-de-France, type magasin', () => {
  const info = classify('ETB 30 ans vu en rayon au Leclerc de Rueil-Malmaison (92) ce matin');
  assert.equal(info.retailer, 'E.Leclerc');
  assert.equal(info.zone, 'IDF');
  assert.equal(info.place, 'Rueil-Malmaison');
  assert.equal(info.dept, '92');
  assert.equal(info.kind, 'magasin');
  assert.deepEqual(info.targets, ['30 ans']);
  assert.equal(placeOf('Arrivage Cultura 95000').dept, '95');
  assert.equal(placeOf('Restock à Lyon Part-Dieu').zone, 'Autre région');
  assert.equal(placeOf('Pokémon Paris World Championships 2026').zone, ''); // « Paris » sans contexte magasin
  assert.equal(retailerOf('dispo chez Joué Club').retailer, 'JouéClub');
});

test('cartes ou pas cartes, et cibles', () => {
  assert.equal(classify('Pokébox Nymphali-ex').tcg, true);
  assert.equal(classify('JAZWARES Figurine Pokémon paillettes 30ème Anniversaire').tcg, false);
  assert.equal(classify('LEGO Pokémon Poké Ball 72154').tcg, false);
  assert.equal(classify('Peluche Pikachu 30 cm').tcg, false);
  assert.deepEqual(targetsOf('Display 36 boosters Méga-Évolution : Règne Delta'), ['Règne Delta', 'Méga-Évolution']);
  assert.deepEqual(targetsOf('Collection Premium Méga-Amphinobi-ex'), []); // pas « 30 ans »
});

test('prix public vs revente', () => {
  assert.equal(publicPriceCap('Pokébox Nymphali-ex'), 35);
  assert.equal(isPublicPrice('Pokébox Nymphali-ex', 26.99), true);
  assert.equal(isPublicPrice('Pokébox Nymphali-ex', 74.95), false);
  assert.equal(isPublicPrice('Coffret Dresseur d’élite 30 ans', 229.9), false);
  assert.equal(isPublicPrice('Collection Ultra-Premium Noctali', 229.99), true);
  assert.equal(isPublicPrice('Objet inconnu', 10), null);
});


test('Dealabs RSS', () => {
  const xml = `<rss><channel><item><title><![CDATA[Coffret Dresseur d'Élite Pokémon 30 ans]]></title><link>https://www.dealabs.com/bons-plans/etb-30-ans-3459999</link>
    <pubDate>Mon, 16 Nov 2026 08:10:00 +0100</pubDate><pepper:merchant name="E.Leclerc" price="55,99€"/>
    <description><![CDATA[<strong>55,99€ - E.Leclerc</strong><p>Vu en rayon au Leclerc de Gennevilliers</p><p>Historique des deals</p>]]></description></item></channel></rss>`;
  const [item] = parseDealabs(xml);
  assert.equal(item.id, 'dealabs:3459999');
  assert.equal(item.at, '2026-11-16T07:10:00Z');
  assert.equal(item.retailer, 'E.Leclerc');
  assert.equal(item.price, 55.99);
  assert.equal(item.publicPrice, true);
  assert.equal(item.kind, 'magasin');
  assert.equal(item.place, 'Gennevilliers');
  assert.equal(item.important, undefined); // posé à la fusion
});

test('Restock Collector RSS : boutique tirée du titre', () => {
  const xml = `<item><title>Restock : Coffret Dresseur d&#039;Élite (ETB) Méga-Évolution : Règne Delta chez Cards Hunter à 65,90 €</title>
    <link>https://restock-collector.com/x/</link><guid isPermaLink="false">rc-event-1</guid><pubDate>Tue, 17 Nov 2026 16:10:00 +0000</pubDate></item>`;
  const [item] = parseRestockCollector(xml);
  assert.equal(item.retailer, 'Cards Hunter');
  assert.equal(item.price, 65.9);
  assert.deepEqual(item.targets.slice(0, 1), ['Règne Delta']);
  assert.equal(item.big, false);
});

test('Auchan et Leclerc : offres des pages de recherche', () => {
  const auchan = `<article><a href="/pokebox-nymphali/pr-abc?x=1"><p class="product-thumbnail__description">Pokébox 30e anniversaire Nymphali-ex</p></a>
    <meta itemprop="price" content="26.99"><meta itemprop="availability" content="https://schema.org/InStock"></article>
    <article><a href="/x/pr-def"><p class="product-thumbnail__description">Pokébox 30e anniversaire Amphinobi-ex</p></a><meta itemprop="price" content="74.95">
    <meta itemprop="availability" content="https://schema.org/InStock"><span class="product-thumbnail__marketplace-label-link">Caverne des jouets</span></article>`;
  const offers = parseAuchanSearch(auchan);
  assert.equal(offers.length, 2);
  assert.deepEqual([offers[0].seller, offers[0].price, offers[0].available], ['Auchan', 26.99, true]);
  assert.equal(offers[1].seller, 'Caverne des jouets');
  assert.equal(offerIsGood(offers[0]), true);
  assert.equal(offerIsGood(offers[1]), false);
  const leclerc = `<article data-ean="0196214146907" data-product-card class="x"><h3><a href="/fp/pokebox-0196214146907?offerId=1" data-product-card-title title="Pokémon : Pokébox 30e anniversaire">x</a></h3>
    <p aria-hidden="true" class="dzpYA"><span class="mdzNT">29</span> <span class="fmRvj"><span>€</span> <span>,</span></span> <span class="bDyJK">99</span> </p></article>`;
  const [offer] = parseLeclercSearch(leclerc);
  assert.equal(offer.url, 'https://www.e.leclerc/fp/pokebox-0196214146907');
  assert.equal(offer.price, 29.99);
});

test('offres : un signal par apparition, pas à chaque passage', () => {
  const offer = { retailer: 'Auchan', name: 'Pokébox 30e anniversaire Nymphali-ex', url: 'https://www.auchan.fr/p', price: 26.99, available: true, seller: 'Auchan' };
  const watch = {};
  const t0 = Date.parse('2026-11-17T10:00:00Z');
  assert.equal(signalsFromOffers([offer], watch, t0).signals.length, 1);
  assert.equal(signalsFromOffers([offer], watch, t0 + 15 * 60000).signals.length, 0);
  const later = signalsFromOffers([offer], watch, t0 + 5 * 3600000); // disparue plus de 3 h puis revenue
  assert.equal(later.signals.length, 1);
  assert.equal(later.available.length, 1);
});

test('fusion des signaux : doublons écartés, PC + GitHub sans perte', () => {
  const a = { id: 'a', at: '2026-11-17T10:00:00Z', retailer: 'X', title: 'Même annonce', tcg: true, targets: [], kind: 'en ligne' };
  const b = { ...a, id: 'b', at: '2026-11-17T09:00:00Z' };
  const c = { ...a, id: 'c', title: 'Autre', at: '2026-11-17T08:00:00Z' };
  const merged = mergeSignals([], [a, b, c], Date.parse('2026-11-17T12:00:00Z'));
  assert.deepEqual(merged.map(item => item.id), ['a', 'c']);
  const local = { generatedAt: '2', signals: [a], notified: ['a'], watch: { k: { lastSeen: '2026-11-17T10:00:00Z' } }, sources: {} };
  const remote = { generatedAt: '1', signals: [c], notified: ['c'], watch: { k: { lastSeen: '2026-11-17T09:00:00Z' } }, sources: {} };
  const both = mergeSignalFiles(local, remote);
  assert.deepEqual(both.signals.map(item => item.id).sort(), ['a', 'c']);
  assert.deepEqual(both.notified.sort(), ['a', 'c']);
  assert.equal(both.watch.k.lastSeen, '2026-11-17T10:00:00Z');
});

test('réassorts détectés par les fiches -> signaux', () => {
  const [item] = signalsFromEvents([{ type: 'pickup', at: '2026-11-17T10:00:00Z', id: 'u', product: 'Pokébox Nymphali-ex', seller: 'UltraJeux', url: 'https://u', to: 'Bastille' }]);
  assert.equal(item.kind, 'magasin');
  assert.equal(item.retailer, 'UltraJeux');
  assert.match(item.title, /Bastille/);
});

test('tendances : jour et créneau à l’heure de Paris, grandes enseignes d’abord', () => {
  assert.equal(slotOf(new Date('2026-11-17T08:30:00Z')), 'matin'); // 9 h 30 à Paris
  assert.equal(slotOf(new Date('2026-11-17T18:30:00Z')), 'soir');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const mk = (retailer, at, big) => ({ tcg: true, retailer, at, big, kind: 'magasin', zone: 'IDF' });
  const result = patterns([mk('Shop', '2026-11-17T09:00:00Z', false), mk('Shop', '2026-11-17T09:30:00Z', false), mk('Shop', '2026-11-17T10:00:00Z', false),
    mk('E.Leclerc', '2026-11-17T08:00:00Z', true), mk('E.Leclerc', '2026-11-10T08:00:00Z', true)], { now });
  assert.equal(Object.keys(result)[0], 'E.Leclerc');
  assert.deepEqual(result['E.Leclerc'].bestDays, ['mardi']);
  assert.equal(result['E.Leclerc'].bestSlot, 'matin');
});


test('magasins parisiens au nom trompeur', () => {
  assert.equal(placeOf('Nouveau retrait en magasin : Métamorph chez UltraJeux (Rennes-Raspail)').zone, 'IDF');
  assert.equal(placeOf('Nouveau retrait en magasin : Métamorph chez UltraJeux (Rennes-Raspail)').dept, '75');
});

test('importance : grandes enseignes au prix boutique, jamais revente ni précommande ; UPC partout', () => {
  const base = { tcg: true, targets: ['30 ans'], kind: 'en ligne', zone: '', big: true, preorder: false };
  assert.equal(isImportant({ ...base, title: 'ETB 30 ans', publicPrice: true }), true);
  assert.equal(isImportant({ ...base, title: 'ETB 30 ans', publicPrice: false }), false);
  assert.equal(isImportant({ ...base, title: 'ETB 30 ans', publicPrice: true, preorder: true }), false);
  assert.equal(isImportant({ ...base, big: false, title: 'ETB 30 ans', publicPrice: true }), false); // boutique spécialisée
  assert.equal(isImportant({ ...base, big: false, title: 'UPC Noctali', publicPrice: true, catalogId: 'upc-noctali', verdict: 'prix boutique' }), true);
  assert.equal(isImportant({ ...base, title: 'Booster 30 ans', publicPrice: true }), false);
  assert.equal(isImportant({ ...base, targets: [], title: 'Booster', kind: 'magasin', zone: 'IDF', publicPrice: null }), true);
});

test('catalogue : reconnaissance des produits et grille enseigne × produit', async () => {
  const { catalogMatch, buildGrid } = await import('../collector/signals/catalog.mjs');
  assert.equal(catalogMatch('Pokémon Coffret Dresseur d’Élite 30e Anniversaire')?.id, 'etb-30');
  assert.equal(catalogMatch('Coffret Dresseur d’Élite (ETB) Méga-Évolution : Règne Delta')?.id, 'etb-delta');
  assert.equal(catalogMatch('Collection Ultra-Premium 30 ans Noctali')?.id, 'upc-noctali');
  assert.equal(catalogMatch('Pokébox 30e anniversaire Nymphali-ex')?.id, 'nymphali');
  assert.equal(catalogMatch('Collection Premium Méga-Amphinobi-ex'), null);
  assert.equal(catalogMatch('Peluche Mewtwo 30 cm'), null);
  const grid = buildGrid([
    { retailer: 'Auchan', name: 'Pokébox 30e anniversaire Nymphali-ex', price: 26.99, available: true, url: 'https://a', seller: 'Auchan' },
    { retailer: 'E.Leclerc', name: 'Pokébox 30e anniversaire Nymphali-ex', price: 74.95, available: true, url: 'https://b', seller: 'X' },
    { retailer: 'E.Leclerc', name: 'Collection figurine Mew 30 ans', price: 1030, available: true, url: 'https://c', seller: 'X' }
  ]);
  assert.equal(grid.nymphali.Auchan.state, 'boutique');
  assert.equal(grid.nymphali['E.Leclerc'].state, 'revendeurs');
  assert.equal(grid.mew['E.Leclerc'].state, 'absent'); // prix aberrant écarté
});

test('analyse de prix : verdict, revente, marge, bonne affaire', async () => {
  const { analyze, buildMarket } = await import('../collector/signals/market.mjs');
  const market = buildMarket([
    { name: 'Pokébox 30e anniversaire Nymphali-ex', price: 74.95, available: true },
    { name: 'Pokébox 30e anniversaire Nymphali-ex', price: 64.95, available: true },
    { name: 'Pokébox 30e anniversaire Nymphali-ex', price: 26.99, available: true }
  ], {}, Date.parse('2026-11-17T10:00:00Z'));
  assert.equal(market.nymphali.median, 69.95);
  const shop = analyze({ title: 'Pokébox 30 ans Nymphali-ex chez Auchan', price: 26.99, tcg: true, big: true, kind: 'en ligne' }, market);
  assert.deepEqual([shop.verdict, shop.margin, shop.deal, shop.refPrice], ['prix boutique', 42.96, true, 26.99]);
  const resale = analyze({ title: 'Collection Premium Métamorph 30 ans chez UltraJeux', price: 99.9, tcg: true, big: false, kind: 'magasin' }, market);
  assert.deepEqual([resale.verdict, resale.deal], ['revente', false]);
  const store = analyze({ title: 'Pokébox Nymphali-ex vue en rayon', price: null, tcg: true, big: true, kind: 'magasin' }, market);
  assert.deepEqual([store.verdict, store.deal, store.margin], ['à vérifier', true, 42.96]);
  assert.equal(analyze({ title: 'Précommande ETB 30 ans', price: 55, tcg: true, big: true, kind: 'en ligne' }, market).deal, false);
});

test('catalogue : les produits dérivés ne passent jamais pour des cartes', async () => {
  const { catalogMatch } = await import('../collector/signals/catalog.mjs');
  for (const title of ["Pokemon Ceinture Poké Ball - POKEMON - Clip'N Go Métamorph - figurine incluse", 'Parure de lit POKEMON Pikachu, Mew & Métamorph',
    'Figurine Pokémon Select 15cm Super-Articulée Mewtwo', 'Peluche Mew 20 cm', 'Figurine Mew 30e anniversaire']) {
    assert.equal(catalogMatch(title), null, title);
  }
});
