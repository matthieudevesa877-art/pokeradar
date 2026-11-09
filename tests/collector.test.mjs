import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CheckError, parseAmazon, parseGeneric, parseLeCoinDesBarons, parseShopifyJs, parseUltraJeux, parseVariantes, toPrice
} from '../collector/adapters.mjs';
import { eventFor, reconcile, summarize } from '../collector/engine.mjs';
import { decodeWatch } from '../app/watch.mjs';
import { mergeSeed } from '../collector/merge-seed.mjs';

const ld = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const product = (availability, price = '25.99', extra = {}) => ld({
  '@context': 'https://schema.org', '@type': 'Product', name: 'Produit', ...extra,
  offers: { '@type': 'Offer', price, priceCurrency: 'EUR', availability }
});

test('toPrice lit les formats français et anglais, refuse le reste', () => {
  assert.equal(toPrice('25,99 €'), 25.99);
  assert.equal(toPrice('25.99,'), 25.99);
  assert.equal(toPrice('1 229,90&nbsp;€'), 1229.9);
  assert.equal(toPrice('1.229,90'), 1229.9);
  assert.equal(toPrice(5999 / 100), 59.99);
  assert.equal(toPrice(''), null);
  assert.equal(toPrice('gratuit'), null);
  assert.equal(toPrice(0), null);
});

test('JSON-LD : disponibilité et prix, y compris dans @graph et avec URL schema.org', () => {
  assert.deepEqual(parseGeneric(product('https://schema.org/InStock')), { status: 'available', price: 25.99 });
  assert.equal(parseGeneric(product('https://schema.org/OutOfStock')).status, 'unavailable');
  assert.equal(parseGeneric(ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Product'], offers: [{ price: 10, availability: 'SoldOut' }] }] })).status, 'unavailable');
  assert.throws(() => parseGeneric('<html>rien</html>'), error => error instanceof CheckError && error.kind === 'parse');
});

test('Coin des Barons : classe WooCommerce, prix du bloc price, contradiction refusée', () => {
  const page = '<p class="stock in-stock">En stock</p><p class="price"> 25,99&euro; </p>';
  assert.deepEqual(parseLeCoinDesBarons(page), { status: 'available', price: 25.99 });
  assert.equal(parseLeCoinDesBarons('<p class="stock out-of-stock">Rupture</p><p class="price"><del>50&euro;</del> <ins>44,99&euro;</ins></p>').price, 44.99);
  assert.throws(() => parseLeCoinDesBarons(product('https://schema.org/InStock') + '<p class="stock out-of-stock">x</p>'), /Contradiction/);
  assert.throws(() => parseLeCoinDesBarons('<html></html>'), CheckError);
});

test('UltraJeux : statut, prix et magasins disponibles uniquement dans le bloc produit', () => {
  const page = `<meta itemprop="Price" content="59.90" /><meta itemprop="availability" content="InStock" />
    <span style="font-size: 15px;">Paris Bastille : <span style='color: green;'>Disponible</span></span>
    <span style="font-size: 15px;">Paris Oberkampf : <span style='color: red;'>Indisponible</span></span>
    <b>Editeur :</b> <span style="font-size: 15px;">Paris Autre : <span>Disponible</span></span>`;
  assert.deepEqual(parseUltraJeux(page), { status: 'available', price: 59.9, pickup: ['Bastille'] });
  assert.equal(parseUltraJeux('<meta itemprop="availability" content="OutOfStock" /><b>Editeur').status, 'unavailable');
  assert.throws(() => parseUltraJeux('<html>autre page</html>'), CheckError);
});

test('Variantes : détecte le retrait exclusif', () => {
  const page = product('https://schema.org/InStock', '74.9', { description: 'EXCLUSIVITE BOUTIQUE CLICK AND COLLECT' });
  assert.deepEqual(parseVariantes(page), { status: 'available', price: 74.9, details: 'Retrait uniquement' });
});

test('Shopify .js : booléen available obligatoire, prix en centimes', () => {
  assert.deepEqual(parseShopifyJs('{"available":true,"price":5299}'), { status: 'available', price: 52.99 });
  assert.equal(parseShopifyJs('{"available":false,"price":5299}').status, 'unavailable');
  assert.throws(() => parseShopifyJs('<html>'), CheckError);
  assert.throws(() => parseShopifyJs('{"price":1}'), CheckError);
});

test('Amazon : invitation, vendu par Amazon, ambigu, anti-robot', () => {
  const offscreen = '<span class="a-offscreen">55,99&nbsp;€</span>';
  assert.deepEqual(parseAmazon(offscreen + 'Demander une invitation'), { status: 'invitation', price: 55.99 });
  assert.equal(parseAmazon('<input id="add-to-cart-button" type="submit"> Expédié par Amazon Vendu par Amazon').status, 'available');
  assert.equal(parseAmazon('Actuellement indisponible.').status, 'unavailable');
  assert.throws(() => parseAmazon('<input id="add-to-cart-button"> Autres vendeurs Vendu par Boutique X'), /ambiguë/);
  assert.throws(() => parseAmazon('<html>Saisissez les caractères que vous voyez captcha</html>'), error => error.kind === 'blocked');
});

const NOW = Date.parse('2026-11-09T12:00:00Z');
const offer = (id, status, extra = {}) => ({
  id, product: `Produit ${id}`, seller: 'Boutique', url: `https://shop.example/${id}`, price: 20, status,
  observedAt: '2026-11-09T08:00:00Z', pickup: [], ...extra
});
const ok = (status, extra = {}) => ({ ok: true, result: { status, price: 20, ...extra } });
const ko = kind => ({ ok: false, error: { kind, message: kind } });

test('réassort : rupture -> disponible produit un événement restock, date mise à jour', () => {
  const out = reconcile({ offers: [offer('a', 'unavailable')], outcomes: new Map([['a', ok('available')]]), now: NOW });
  assert.equal(out.offers[0].status, 'available');
  assert.equal(out.offers[0].observedAt, '2026-11-09T12:00:00Z');
  assert.deepEqual(out.newEvents.map(event => event.type), ['restock']);
  assert.equal(out.changed, true);
});

test('échec de contrôle : ancienne observation et date conservées, échecs comptés', () => {
  const row = offer('a', 'available');
  const out = reconcile({ offers: [row], outcomes: new Map([['a', ko('blocked')]]), health: { a: { failures: 1, lastOkAt: 'x' } }, now: NOW });
  assert.equal(out.offers[0], row);
  assert.equal(out.changed, false);
  assert.equal(out.health.a.failures, 2);
  assert.equal(out.health.a.lastOkAt, 'x');
  assert.equal(out.newEvents.length, 0);
});

test('prix et nouveaux magasins de retrait génèrent des événements', () => {
  const prev = offer('a', 'available', { pickup: ['Bastille'] });
  const next = { ...prev, price: 18, pickup: ['Bastille', 'Oberkampf'] };
  assert.deepEqual(eventFor(prev, next, 't').map(event => event.type), ['price', 'pickup']);
  assert.equal(eventFor(prev, prev, 't').length, 0);
  assert.equal(eventFor(offer('a', 'available'), offer('a', 'unavailable'), 't')[0].type, 'soldout');
});

test('garde-fou : rupture massive sur un site = relevé conservé', () => {
  const offers = ['a', 'b', 'c', 'd', 'e'].map(id => offer(id, 'available'));
  const outcomes = new Map(offers.map(row => [row.id, ok('unavailable')]));
  const out = reconcile({ offers, outcomes, now: NOW });
  assert.equal(out.suspect.length, 5);
  assert.ok(out.offers.every((row, index) => row === offers[index]));
  assert.equal(out.newEvents.length, 0);
  // en dessous du seuil minimum, une vraie rupture isolée passe
  const small = reconcile({ offers: offers.slice(0, 2), outcomes: new Map([['a', ok('unavailable')], ['b', ok('available')]]), now: NOW });
  assert.equal(small.offers[0].status, 'unavailable');
});

test('fiche non contrôlée : intacte ; relevé produit toujours valide pour l\'appli', () => {
  const rows = [offer('a', 'available'), offer('b', 'unknown', { price: null })];
  const out = reconcile({ offers: rows, outcomes: new Map([['a', ok('unavailable', { price: 21 })]]), now: NOW });
  assert.equal(out.offers[1], rows[1]);
  const feed = decodeWatch({ version: 1, offers: out.offers, campaigns: [], releases: [] }, NOW + 1000);
  assert.equal(Date.parse(feed.offers[0].observedAt), NOW);
});

test('fusion graine/relevé : observations publiées conservées, fiches ajoutées ou retirées suivies', () => {
  const seed = { version: 1, offers: [offer('a', 'unknown'), offer('nouvelle', 'unknown')], campaigns: [], releases: [] };
  const published = { offers: [offer('a', 'available', { price: 18, product: 'ancien nom' }), offer('retiree', 'available')] };
  const merged = mergeSeed(seed, published);
  assert.deepEqual(merged.offers.map(row => row.id), ['a', 'nouvelle']);
  assert.equal(merged.offers[0].status, 'available');
  assert.equal(merged.offers[0].price, 18);
  assert.equal(merged.offers[0].product, 'Produit a');
  assert.equal(merged.offers[1].status, 'unknown');
});

test('santé : états par site', () => {
  const rows = [offer('a', 'available'), offer('b', 'available', { url: 'https://other.example/b' }), offer('c', 'available', { url: 'https://third.example/c' })];
  const outcomes = new Map([['a', ok('available')], ['b', ko('blocked')]]);
  const { hosts } = summarize(rows, outcomes, {}, NOW);
  assert.equal(hosts['shop.example'].state, 'ok');
  assert.equal(hosts['other.example'].state, 'bloqué');
  assert.equal(hosts['third.example'].state, 'non contrôlé');
});
