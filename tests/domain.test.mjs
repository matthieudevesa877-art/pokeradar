import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { RAFFLES, SOURCES, TRACKERS } from '../app/catalog.mjs';
import { decodeWatch, recentWatchStocks, WATCH_FRESH_MS } from '../app/watch.mjs';
import {
  alertMatches, calendarFile, decodeBackup, emptyData, marginEstimate, marketSummary,
  mergeData, raffleStatus, searchUrl, stockObservations, stockStatus
} from '../app/domain.mjs';

const NOW = Date.parse('2026-11-07T15:00:00Z');
const stock = {
  id: 'v04-1', product: 'ETB Règne Delta FR', store: 'Fnac La Défense',
  state: 'Disponible signalé', price: 59.99, method: 'Appel téléphonique',
  url: 'https://www.fnac.com/', checked: '2026-11-07T14:00:00.000Z'
};
const offer = {
  id: 'price-1', product: stock.product, source: 'Fnac', kind: 'Annonce',
  price: 69.99, shipping: 4.50, url: stock.url, checked: stock.checked
};
const rules = [
  { id: 'rule-1', product: ' etb regne delta FR  ', type: 'stock', max: null },
  { id: 'rule-2', product: stock.product, type: 'price', max: 74.49 }
];

test('importe le format JSON du portail v0.4', () => {
  const backup = decodeBackup(JSON.stringify([stock]), NOW);
  assert.deepEqual(backup.stocks, [stock]);
  assert.deepEqual(backup.prices, []);
});

test('fusionne sans doublon et garde le marqueur de migration', () => {
  const current = { ...emptyData(), stocks: [stock], portalMigrated: true };
  const newer = { ...stock, id: 'v04-2', checked: '2026-11-07T14:30:00.000Z' };
  const imported = decodeBackup([stock, newer], NOW);
  const result = mergeData(current, imported);
  assert.deepEqual(result.stocks, [stock, newer]);
  assert.equal(result.portalMigrated, true);
  assert.deepEqual(mergeData(result, imported), result);
});

test('interrompt une fusion conflictuelle sans toucher aux données existantes', () => {
  const current = { ...emptyData(), stocks: [stock] };
  assert.throws(() => mergeData(current, decodeBackup([{ ...stock, price: 40 }], NOW)), /même identifiant/);
  assert.deepEqual(current.stocks, [stock]);
  assert.throws(() => decodeBackup([stock, { ...stock, price: 40 }], NOW), /même identifiant/);
});

test('refuse les liens actifs injectés et les relevés futurs', () => {
  for (const url of ['javascript:alert(1)', 'https://example.com@evil.test/', 'http://example.test']) {
    assert.throws(() => decodeBackup([{ ...stock, url }], NOW), /HTTPS/);
  }
  assert.throws(() => decodeBackup([{ ...stock, checked: '2099-01-01' }], NOW), /futur/);
});

test('conserve les listes historiques et accepte les sauvegardes précédentes', () => {
  const data = { ...emptyData(), stocks: [stock], prices: [offer], alerts: rules, followed: [{ id: 'fnac-2026-11-13' }] };
  assert.deepEqual(decodeBackup(JSON.stringify(data), NOW), {
    ...data, alerts: [{ ...rules[0], product: 'etb regne delta FR' }, rules[1]]
  });
  const { customRaffles, calendar, ...older } = data;
  assert.deepEqual(decodeBackup(older, NOW).customRaffles, []);
  assert.deepEqual(decodeBackup(older, NOW).calendar, []);
});

test('garde les participations, tirages personnels et dates importées du bot', () => {
  const backup = decodeBackup({
    ...emptyData(),
    followed: [{ id: 'v04-custom-1', status: 'Inscrit', note: 'Depuis le Mac' }],
    customRaffles: [{ id: 'v04-custom-1', brand: 'Fnac', title: 'Vente privée', category: 'Accès à l’achat', url: stock.url, deadline: '2026-11-10T20:00:00+01:00' }],
    calendar: [{ id: 'v04-date-1', date: '2026-11-27', detail: 'sortie', title: 'Sortie', url: stock.url }]
  }, NOW);
  assert.equal(backup.followed[0].note, 'Depuis le Mac');
  assert.equal(backup.customRaffles[0].deadline, '2026-11-10T19:00:00.000Z');
  assert.equal(backup.calendar[0].date, '2026-11-27');
  assert.equal(backup.customRaffles[0].state, 'à vérifier');
});

test('fait expirer les signaux après 24 h et distingue les stocks inconnus', () => {
  assert.equal(stockStatus(stock, NOW), 'Disponible signalé');
  assert.equal(stockStatus(stock, Date.parse(stock.checked) + 86400000), 'Relevé à actualiser');
  assert.equal(stockStatus({ ...stock, state: 'Inconnu' }, NOW), 'Stock inconnu');
});

test('un nouveau relevé du même magasin annule le signal de stock précédent', () => {
  const data = { ...emptyData(), stocks: [stock], prices: [offer], alerts: rules };
  assert.deepEqual(alertMatches(data, NOW).map(entry => entry.rows.length), [1, 1]);
  const newer = { ...stock, id: 'next', checked: '2026-11-07T14:30:00.000Z', state: 'Indisponible signalé' };
  assert.deepEqual(alertMatches({ ...data, stocks: [stock, newer] }, NOW).map(entry => entry.rows.length), [0, 1]);
  assert.deepEqual(stockObservations([stock, newer], NOW).map(item => item.status), ['Indisponible signalé', 'Relevé remplacé']);
  assert.deepEqual(alertMatches(data, NOW + 86400000).map(entry => entry.rows.length), [0, 0]);
});

test('exclut de l’alerte d’achat les ventes réalisées, livraisons inconnues et offres hors budget', () => {
  for (const prices of [[{ ...offer, shipping: null }], [{ ...offer, kind: 'Vente réalisée' }], [{ ...offer, shipping: 4.51 }]]) {
    const data = { ...emptyData(), prices, alerts: [rules[1]] };
    assert.deepEqual(alertMatches(data, NOW)[0].rows, []);
  }
});

test('sépare offres et ventes et évite de combiner les variantes', () => {
  const sales = [78, 80, 105, 90].map(price => ({ ...offer, price, kind: 'Vente réalisée' }));
  assert.deepEqual(marketSummary([offer, ...sales]), { sold: 85, soldCount: 4, asking: 74.49, askingCount: 1 });
  assert.equal(marketSummary([offer, { ...offer, product: 'ETB Règne Delta JP' }]), null);
  assert.deepEqual(marketSummary([
    { ...offer, kind: 'Cote indicative' }, { ...offer, kind: 'Vente à vérifier' }, { ...offer, outOfStock: true }
  ]), { sold: null, soldCount: 0, asking: null, askingCount: 0 });
});

test('intègre les frais et calcule un seuil de rentabilité', () => {
  const input = { buy: 60, shipping: 5, sell: 85, fees: 5, other: 3 };
  const result = marginEstimate(input);
  assert.equal(result.gain, 12.75);
  assert.equal(result.ratio, 18.75);
  assert.ok(Math.abs(result.breakEven - 71.578947) < 0.00001);
  assert.equal(marginEstimate({ ...input, buy: 0, shipping: 0, other: 0 }).ratio, null);
  assert.equal(marginEstimate({ ...input, fees: 100 }).breakEven, null);
  assert.throws(() => marginEstimate({ ...input, fees: 101 }), /100/);
});

test('archive le tirage Fnac à l’échéance et conserve les liens hérités', () => {
  const fnac = RAFFLES.find(row => row.id === 'fnac-2026-11-13');
  assert.equal(raffleStatus(fnac, NOW), 'Annoncé par l’enseigne');
  assert.equal(raffleStatus(fnac, Date.parse('2026-11-10T23:00:00Z')), 'Date dépassée');
  assert.equal(raffleStatus(RAFFLES.find(row => row.id === 'amazon-invitation-30ans'), NOW), 'Clôturé');
  assert.equal(SOURCES.length, 27);
  assert.equal(RAFFLES.length, 9);
  const reported = RAFFLES.find(row => row.id === 'coin-tcg-2026-11-10');
  assert.equal(raffleStatus(reported, NOW), 'Signalé');
  assert.equal(new URL(reported.url).hostname, 'pokescam.com');
  assert.equal(TRACKERS.length, 7);
  assert.equal(new URL(searchUrl(SOURCES[0], 'ETB & FR')).searchParams.get('k'), 'ETB & FR');
});

test('garde les invitations et les anciennes observations hors des alertes de disponibilité', () => {
  const now = Date.parse('2026-11-09T10:00:00Z');
  const item = { id: 'direct', product: 'ETB 30 ans', seller: 'Boutique', url: stock.url, price: 55.99,
    observedAt: '2026-11-09T09:00:00Z', status: 'available' };
  const raw = { version: 1, campaigns: [], releases: [], offers: [
    item, { ...item, id: 'invite', status: 'invitation' }, { ...item, id: 'archive', observedAt: '2026-11-09' }
  ] };
  const watch = decodeWatch(raw, now);
  const stocks = recentWatchStocks(watch.offers, now);
  assert.equal(stocks.length, 1);
  assert.deepEqual(recentWatchStocks(watch.offers, now + WATCH_FRESH_MS), []);
  raw.offers[0].url = 'javascript:alert(1)';
  assert.throws(() => decodeWatch(raw, now), /HTTPS/);
});

test('exporte un rappel horodaté ou à la journée au format calendrier', () => {
  const event = { id: 'fnac', title: 'Règne Delta ; ' + 'Réassort '.repeat(12), description: 'Fnac,\nParis', url: stock.url };
  const deadline = calendarFile({ ...event, deadline: '2026-11-11T00:00:00+01:00' }, new Date(NOW));
  assert.match(deadline, /DTSTART:20261110T230000Z/);
  assert.match(deadline, /DESCRIPTION:Fnac\\,\\nParis/);
  assert.ok(deadline.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const release = calendarFile({ ...event, date: '2026-11-27' }, new Date(NOW));
  assert.match(release, /DTSTART;VALUE=DATE:20261127/);
  assert.match(release, /TRIGGER:-P1D/);
});

test('trouve les fichiers hors ligne et les icônes déclarées dans le manifeste', async () => {
  const app = new URL('../app/', import.meta.url);
  const worker = await readFile(new URL('sw.js', app), 'utf8');
  const assets = [...worker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]);
  assert.ok(assets.includes('index.html'));
  assert.ok(assets.includes('app.mjs'));
  await Promise.all(assets.map(path => readFile(new URL(path, app))));
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', app), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const item of manifest.icons) {
    const icon = await readFile(new URL(item.src, app));
    assert.equal(icon.readUInt32BE(16) + 'x' + icon.readUInt32BE(20), item.sizes);
  }
});

test('sert une navigation avec onglet et paramètres depuis le cache hors ligne', async () => {
  const source = await readFile(new URL('../app/sw.js', import.meta.url), 'utf8');
  const scope = 'https://example.test/pokeradar/';
  const handlers = new Map();
  const cached = new Map();
  const cache = {
    addAll: async requests => { for (const request of requests) cached.set(request.url, 'cache de ' + request.url); },
    match: async url => cached.get(url)
  };
  runInNewContext(source, {
    URL, Request, caches: { open: async () => cache },
    self: { registration: { scope }, skipWaiting: async () => {}, addEventListener: (type, callback) => handlers.set(type, callback) },
    fetch: () => { throw new Error('Réseau indisponible'); }
  });
  let pending;
  handlers.get('install')({ waitUntil: promise => { pending = promise; } });
  await pending;
  handlers.get('fetch')({
    request: { url: scope + '?origine=accueil#stocks', method: 'GET', mode: 'navigate' },
    respondWith: promise => { pending = promise; }
  });
  assert.equal(await pending, 'cache de ' + scope + 'index.html');
  let intercepted = false;
  handlers.get('fetch')({
    request: { url: scope + 'veille.json', method: 'GET', mode: 'cors' },
    respondWith: () => { intercepted = true; }
  });
  assert.equal(intercepted, false);
});
