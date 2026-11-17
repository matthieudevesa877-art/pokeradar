import {
  calendarFile, decodeBackup, emptyData, mapUrl, mergeData, METHODS, STOCK_STATES, stockObservations, stockRecord
} from './domain.mjs';
import { access, migratePortal, openStorage } from './storage.mjs';
import { decodeWatch, mergeWatchEntries } from './watch.mjs';

const ROUTES = {
  accueil: ['Radar', 'Radar', 'radar'],
  rentable: ['Rentable ?', 'Rentable ?', 'chart'],
  magasins: ['Mes magasins', 'Mes magasins', 'pin'],
  donnees: ['Mes données', 'Sauvegardes et installation', 'archive']
};
const ICONS = {
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M3 4v16h18M7 15l4-4 4 2 5-7"/><path d="M17 6h3v3"/>',
  bag: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M19 10c0 5-7 10-7 10s-7-5-7-10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0v5l2 3H4l2-3V9ZM10 21h4"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z"/><path d="M14 7v2m0 2v2m0 2v2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  external: '<path d="M13 5h6v6m0-6-9 9m7-1v6H5V7h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  box: '<path d="m12 3 8 4v10l-8 4-8-4V7l8-4Zm-8 4 8 4 8-4m-8 4v10M8 5l8 4"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 10h16"/>'
};
const RELEASES = [
  {
    id: 'regne-delta', title: 'Règne Delta', detail: 'Nouvelle extension', date: '2026-11-06', tone: 'mint',
    url: 'https://www.pokemon.com/fr/actualites/jcc-pokemon-apercu-des-produits-mega-evolution-regne-delta',
    description: 'Sortie de l’extension Méga-Évolution annoncée par Pokémon.'
  },
  {
    id: 'mentali', title: 'Collection Journée · Mentali', detail: 'Coffret Ultra-Premium', date: '2026-11-27', tone: 'pink',
    url: 'https://radarstock.fr/calendrier/pokemon/', description: 'Date indicative publiée par Radar Stock. Vérifie les annonces de l’enseigne.'
  },
  {
    id: 'mewtwo', title: 'Collection avec figurine Mewtwo', detail: '30ᵉ Anniversaire', date: '2026-11-27', tone: 'gold',
    url: 'https://radarstock.fr/calendrier/pokemon/', description: 'Date indicative publiée par Radar Stock. Vérifie les annonces de l’enseigne.'
  }
];
const ZONE = 'Europe/Paris';
const fullDate = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, day: 'numeric', month: 'short' });
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const screen = document.querySelector('#screen');
const editor = document.querySelector('#editor');
const navigation = document.querySelector('#navigation');
const feedback = document.querySelector('#feedback');
const watchStatus = document.querySelector('#watch-status');
const watchRefresh = document.querySelector('#watch-refresh');
const watchKey = 'pokeradar-public-watch-v1';
let localZone = 'Suresnes';
let data = emptyData();
let db;
let feedbackTimer;
let offlineState = 'Préparation du mode hors ligne…';
let watch = { offers: [], campaigns: [], releases: [] };
let watchLoading;
let watchRenderPending = false;
let collectorHealth = null;
let collectorEvents = null;
let signalsFeed = null;
let signalFilter = 'Bonnes affaires';
const SIGNAL_FILTERS = ['Bonnes affaires', 'Magasins IDF', '30 ans', 'Règne Delta', 'Tout'];

function el(tag, classes, ...children) {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  node.append(...children.flat().filter(child => child !== null && child !== undefined));
  return node;
}

function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = ICONS[name];
  return node;
}

function link(label, href, { variant = 'secondary', symbol } = {}) {
  const node = el('a', 'button ' + variant, symbol ? icon(symbol) : null, label);
  node.href = href;
  return node;
}

function out(label, href, variant = 'secondary') {
  const node = link(label, href, { variant, symbol: 'external' });
  node.target = '_blank'; // ouvre un nouvel onglet : l'appli reste en place derrière
  node.rel = 'noopener noreferrer';
  return node;
}

function button(label, action, { variant = 'secondary', symbol, disabled = false } = {}) {
  const node = el('button', 'button ' + variant, symbol ? icon(symbol) : null, label);
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
}

function badge(label, tone = 'neutral') {
  return el('span', 'badge ' + tone, label);
}

function empty(symbol, title, description) {
  return el('div', 'empty', el('span', 'tile', icon(symbol)), el('strong', '', title), el('p', '', description));
}

function heading(title, description, action = null) {
  return el('div', 'page-heading',
    el('div', '', el('h1', '', title), el('p', '', description)), action);
}

function sectionTitle(title, right = null) {
  return el('div', 'section-title', el('h2', '', title), right);
}

function filterBar(labels, active, onSelect) {
  const bar = el('div', 'filters');
  for (const label of labels) {
    const chip = button(label, () => {
      for (const node of bar.children) node.setAttribute('aria-pressed', String(node === chip));
      onSelect(label);
    }, { variant: 'chip' });
    chip.setAttribute('aria-pressed', String(label === active));
    bar.append(chip);
  }
  return bar;
}

function announce(message) {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.classList.add('show');
  feedbackTimer = setTimeout(() => feedback.classList.remove('show'), 4500);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = el('a', '');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function change(update) {
  if (!db) throw new Error('Le stockage local est indisponible dans ce navigateur.');
  data = await access(db, update);
  channel?.postMessage('updated');
}

function addRecord(collection, record) {
  return change(current => {
    const updated = mergeData(current, { ...emptyData(), [collection]: [record] });
    return { ...updated, [collection]: [record, ...updated[collection].filter(row => row.id !== record.id)] };
  });
}

function removeRecord(collection, id, label) {
  openEditor('Supprimer ' + label + ' ?', [], async () => {
    await change(current => ({ ...current, [collection]: current[collection].filter(row => row.id !== id) }));
  }, { submit: 'Supprimer', description: 'Cette entrée sera retirée de ton carnet.' });
}

const OLD_ROUTES = { boutiques: 'rentable', marche: 'rentable', stocks: 'magasins', alertes: 'accueil' };
function route() {
  const key = location.hash.slice(1).split('/')[0];
  if (OLD_ROUTES[key]) return OLD_ROUTES[key];
  return Object.hasOwn(ROUTES, key) ? key : 'accueil';
}

function field(name, label, options = {}) {
  const input = options.values ? el('select', '') : el('input', '');
  input.name = name;
  if (options.values) {
    for (const value of options.values) input.append(new Option(value, value));
  } else {
    input.type = options.type ?? 'text';
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (input.type === 'number') {
      input.step = '0.01';
      input.min = '0';
      input.max = options.max ?? '1000000';
      input.inputMode = 'decimal';
    }
    if (input.type === 'search') input.enterKeyHint = 'search';
  }
  input.required = options.required ?? false;
  input.value = options.value ?? options.values?.[0] ?? '';
  return el('label', 'field', el('span', '', label), input);
}

function openEditor(title, fields, save, options = {}) {
  const error = el('p', 'form-error');
  error.setAttribute('role', 'alert');
  const form = el('form', 'editor-form');
  const caption = el('h2', '', title);
  caption.id = 'editor-title';
  caption.tabIndex = -1;
  const close = button('', () => editor.close(), { variant: 'icon-button', symbol: 'close' });
  close.setAttribute('aria-label', 'Fermer');
  const submit = el('button', 'button primary', options.submit ?? 'Enregistrer');
  submit.type = 'submit';
  form.append(
    el('div', 'editor-title', caption, close),
    options.description ? el('p', 'muted', options.description) : '',
    el('div', 'form-grid', fields), error, el('div', 'actions', submit)
  );
  let saving = false;
  editor.oncancel = event => { if (saving) event.preventDefault(); };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = submit.disabled = close.disabled = true;
    error.textContent = '';
    try {
      await save(Object.fromEntries(new FormData(form)));
      editor.close();
      render();
      announce(options.submit === 'Supprimer' ? 'Entrée supprimée.' : 'Enregistré dans ton carnet.');
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      saving = submit.disabled = close.disabled = false;
    }
  });
  editor.replaceChildren(form);
  editor.showModal();
  caption.focus();
}

function id() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + '-' + crypto.getRandomValues(new Uint32Array(2)).join('-');
}

function editStock(product = '', store = '') {
  openEditor('Nouveau relevé de stock', [
    field('product', 'Produit et variante', { required: true, maxLength: 160, value: product, placeholder: 'ETB Règne Delta FR' }),
    field('store', 'Magasin et ville', { required: true, maxLength: 100, value: store, placeholder: 'Fnac La Défense' }),
    field('state', 'Statut observé', { values: STOCK_STATES }),
    field('price', 'Prix (€), si connu', { type: 'number' }),
    field('method', 'Méthode de vérification', { values: METHODS }),
    field('url', 'Lien de la fiche (facultatif)', { type: 'url', maxLength: 2048 })
  ], values => addRecord('stocks', stockRecord({ ...values, id: id(), checked: new Date().toISOString() })),
  { description: 'La date est ajoutée au moment de l’enregistrement.' });
}



function releaseCard(entry) {
  const official = entry.id === 'regne-delta';
  const sourceLabel = official ? 'Pokémon officiel' : entry.id.startsWith('v04-') ? 'Annonce importée' : 'Date indicative';
  const date = dateOnly.format(new Date(entry.date + 'T12:00:00Z'));
  return el('article', 'release',
    el('div', 'release-art ' + entry.tone, icon(official ? 'box' : 'ticket')),
    el('div', 'release-body',
      el('p', 'muted mini', entry.detail),
      el('h3', '', entry.title),
      el('p', 'release-date', icon('calendar'), date, ' · ' + sourceLabel),
      el('div', 'actions', out('Voir la source', entry.url, 'quiet'),
        official ? null : button('Rappel calendrier', () => download(
          'pokeradar-' + entry.id + '.ics', calendarFile(entry), 'text/calendar;charset=utf-8'
        ), { variant: 'quiet' }))
    )
  );
}



function offerDate(row) {
  return row.observedAt.length === 10 ? dateOnly.format(new Date(row.observedAt + 'T12:00:00Z')) :
    fullDate.format(new Date(row.observedAt));
}





function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return 'il y a ' + minutes + ' min';
  if (minutes < 48 * 60) return 'il y a ' + Math.round(minutes / 60) + ' h';
  return 'il y a ' + Math.round(minutes / 1440) + ' j';
}

// Par défaut : grandes enseignes uniquement, pas de précommande, jamais au-dessus du prix boutique.
function signalMatches(item, filter) {
  if (!item.tcg) return false;
  if (filter === 'Tout') return true;
  const useful = item.big && !item.preorder && item.verdict !== 'revente';
  if (filter === 'Bonnes affaires') return Boolean(item.deal);
  if (filter === 'Magasins IDF') return useful && item.kind === 'magasin' && item.zone === 'IDF';
  if (filter === '30 ans' || filter === 'Règne Delta') return useful && item.targets.includes(filter);
  return useful;
}

function signalCard(item) {
  const where = [item.retailer, item.place || (item.dept ? 'dép. ' + item.dept : ''), item.zone === 'Autre région' ? 'hors Île-de-France' : '']
    .filter(Boolean).join(' · ');
  const storeSearch = item.retailer && (item.kind === 'magasin' || item.big) ? mapUrl(item.retailer + ' ' + (item.place || item.dept || 'Suresnes')) : null;
  return el('article', 'record signal' + (item.important ? ' is-important' : ''),
    el('div', 'record-top',
      el('span', 'signal-when', badge(item.kind === 'magasin' ? 'En magasin' : 'En ligne', item.kind === 'magasin' ? 'pink' : 'lavender'), ' ', ago(item.at)),
      item.price ? el('strong', 'price', euro.format(item.price)) : null),
    el('h3', '', item.title),
    where ? el('p', 'muted', where) : null,
    el('div', 'chips',
      item.verdict === 'prix boutique' ? badge('Prix boutique', 'mint') : item.verdict === 'revente' ? badge('Prix revendeur', 'neutral') :
        item.verdict === 'à vérifier' ? badge('Prix à vérifier', 'gold') : null,
      item.preorder ? badge('Précommande', 'neutral') : null,
      !item.big ? badge('Boutique spécialisée', 'neutral') : null,
      ...item.targets.map(target => badge(target, target === '30 ans' ? 'gold' : 'lavender'))),
    item.refPrice ? el('p', 'mini muted', 'Prix boutique de référence ' + (item.refApprox ? '≈ ' : '') + euro.format(item.refPrice) +
      (Number.isFinite(item.price) ? ' · ici ' + euro.format(item.price) : '')) : null,
    Number.isFinite(item.resale) ? el('p', 'mini resale', 'Revente observée ~' + euro.format(item.resale) +
      (Number.isFinite(item.margin) && item.margin > 0 ? ' · marge estimée +' + euro.format(item.margin) + (item.verdict === 'à vérifier' ? ' si au prix boutique' : '') : '') +
      ' (' + item.resaleN + ' offre' + (item.resaleN > 1 ? 's' : '') + ' de revendeurs)') : null,
    el('p', 'mini muted', 'Source : ' + item.source + ' · ' + fullDate.format(new Date(item.at))),
    el('div', 'actions', out('Voir', item.link || item.url), storeSearch ? out('Magasins & téléphone', storeSearch, 'quiet') : null));
}

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const weekday = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, weekday: 'long' });

// Mes propres repérages « Disponible signalé » (onglet Stocks), par magasin et par jour.
function myPatterns() {
  const stores = {};
  for (const row of data.stocks) {
    if (row.state !== 'Disponible signalé') continue;
    const day = DAY_NAMES.indexOf(weekday.format(new Date(row.checked.length === 10 ? row.checked + 'T12:00:00Z' : row.checked)));
    if (day < 0) continue;
    const entry = stores[row.store] ??= { n: 0, magasin: 1, days: [0, 0, 0, 0, 0, 0, 0], bestDays: [], bestSlot: '', mine: true };
    entry.n += 1;
    entry.days[day] += 1;
  }
  for (const entry of Object.values(stores)) {
    entry.bestDays = entry.days.map((count, index) => [count, DAY_NAMES[index]]).filter(([count]) => count > 0)
      .sort((x, y) => y[0] - x[0]).slice(0, 2).map(([, day]) => day);
  }
  return stores;
}

function trendRow([name, entry]) {
  const letters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const max = Math.max(...entry.days, 1);
  return el('div', 'trend',
    el('div', '', el('strong', '', name), el('p', 'mini muted',
      (entry.mine ? entry.n + ' repérage(s) à moi' : entry.n + ' signal(s)' + (entry.magasin ? ' · ' + entry.magasin + ' en magasin' : '')) +
      (entry.bestDays.length ? ' · surtout le ' + entry.bestDays.join(' et le ') : '') + (entry.bestSlot ? ' · ' + entry.bestSlot : ''))),
    el('div', 'trend-bars', ...entry.days.map((count, index) => {
      const bar = el('span', '', el('i', ''), el('small', '', letters[index]));
      bar.firstChild.style.height = Math.max(2, Math.round(count / max * 28)) + 'px';
      bar.title = count + ' le ' + DAY_NAMES[index];
      return bar;
    })));
}


// Produits classés par marge estimée (revente observée – prix boutique) : quoi demander en priorité en magasin.
function huntList(feed) {
  const rows = (feed.catalog ?? []).map(product => ({ product, market: feed.market?.[product.id] }))
    .filter(row => row.market && row.market.median > row.product.price)
    .map(row => ({ ...row, margin: Math.round((row.market.median - row.product.price) * 100) / 100 }))
    .sort((a, b) => b.margin - a.margin).slice(0, 6);
  if (!rows.length) return null;
  return el('section', 'section',
    sectionTitle('Quoi chercher en priorité', link('Calculer une marge', '#rentable', { variant: 'quiet', symbol: 'arrow' })),
    el('p', 'mini muted', 'Marge estimée par pièce si tu l’achètes au prix boutique, d’après les prix des revendeurs vus sur Auchan et Leclerc. Frais de vente non déduits.'),
    el('div', 'hunt-list', ...rows.map(({ product, market, margin }) => el('div', 'hunt',
      el('div', '', el('strong', '', product.name), el('p', 'mini muted', 'Boutique ' + (product.approx ? '≈ ' : '') + euro.format(product.price) +
        ' · revente ~' + euro.format(market.median) + ' (' + market.n + ' offre' + (market.n > 1 ? 's' : '') + ')')),
      el('strong', 'hunt-margin', '+' + euro.format(margin))))));
}

function radarSections() {
  const feed = signalsFeed;
  if (!feed) return [el('section', 'section', empty('radar', 'Radar en cours de chargement', 'Les signaux arrivent avec la prochaine actualisation.'))];
  const sources = Object.entries(feed.sources ?? {});
  // « À jour » : lue avec succès dans l’heure (les enseignes ne sont relues que toutes les 20 min).
  const okSources = sources.filter(([, value]) => value.state === 'ok' || (value.lastOkAt && Date.now() - Date.parse(value.lastOkAt) < 3600000)).length;
  const available = (feed.available ?? []).filter(item => Date.now() - Date.parse(item.lastSeen) < 6 * 3600000);
  const results = el('div', 'record-grid');
  const paint = () => {
    const rows = feed.signals.filter(item => signalMatches(item, signalFilter)).slice(0, 40);
    results.replaceChildren(...(rows.length ? rows.map(signalCard) : [empty('search', 'Aucun signal pour ce filtre',
      signalFilter === 'Magasins IDF' ? 'Peu de signalements publics en magasin dans les grandes enseignes : note les tiens avec « J’ai vu du stock ».' :
      signalFilter === 'Bonnes affaires' ? 'Aucune grande enseigne au prix boutique en ce moment. Tu seras alerté dès que ça bouge ; l’onglet Rentable ? te permet de vérifier en un tap.' : 'Essaie un autre filtre.')]));
  };
  paint();
  return [
    el('section', 'section',
      sectionTitle('Au prix boutique, maintenant', link('Vérifier en un tap', '#rentable', { variant: 'quiet', symbol: 'arrow' })),
      el('p', 'mini muted', 'Mis à jour ' + ago(feed.generatedAt) + ' · ' + okSources + '/' + sources.length +
        ' sources à jour · Auchan, Leclerc, Dealabs, Restock Collector, Amazon.'),
      el('div', 'record-grid', ...(available.length ? available.map(signalCard) : [empty('search', 'Rien au prix boutique en ligne pour l’instant',
        'Auchan et Leclerc sont relus à chaque passage pour les produits 30 ans et Règne Delta. Une alerte part dès qu’un prix boutique réapparaît.')]))),
    huntList(feed),
    el('section', 'section',
      sectionTitle('Signaux récents'),
      filterBar(SIGNAL_FILTERS, signalFilter, value => { signalFilter = value; paint(); }),
      results),
  ];
}

function home() {
  return [
    heading('Ton radar Pokémon', 'Le stock au prix boutique dans les grandes enseignes, et quoi chercher en priorité.',
      button('J’ai vu du stock', quickSighting, { variant: 'primary', symbol: 'plus', disabled: !db })),
    ...radarSections(),
    el('section', 'section',
      sectionTitle('Prochaines sorties en magasin'),
      el('div', 'release-grid', [...mergeWatchEntries(RELEASES, watch.releases), ...data.calendar]
        .filter(entry => entry.date >= new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10))
        .sort((a, b) => a.date.localeCompare(b.date)).map(releaseCard))),
    el('div', 'data-note', icon('bell'),
      el('div', '', el('strong', '', 'Alertes sur ton téléphone'),
        el('p', '', 'Avec l’appli gratuite ntfy et ton sujet privé, chaque bonne affaire d’une grande enseigne arrive en notification.'),
        out('ntfy sur l’App Store', 'https://apps.apple.com/app/ntfy/id1625396347', 'quiet')))
  ];
}





const CHECK_SHOPS = [
  ['Fnac', q => 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=' + encodeURIComponent(q)],
  ['Cultura', q => 'https://www.cultura.com/search/results?search_query=' + encodeURIComponent(q)],
  ['Carrefour', q => 'https://www.carrefour.fr/s?q=' + encodeURIComponent(q)],
  ['Auchan', q => 'https://www.auchan.fr/recherche?text=' + encodeURIComponent(q)],
  ['Leclerc', q => 'https://www.e.leclerc/recherche?q=' + encodeURIComponent(q)],
  ['Smyths', q => 'https://www.smythstoys.com/fr/fr-fr/search/?text=' + encodeURIComponent(q)],
  ['Grande Récré', q => 'https://www.lagranderecre.fr/catalogsearch/result/?q=' + encodeURIComponent(q)],
  ['Amazon', q => 'https://www.amazon.fr/s?k=' + encodeURIComponent(q) + '&rh=p_6%3AA1X6FK5RDHNB96']
];

function gridState(entry) {
  if (!entry) return el('span', 'mini muted', 'pas encore lu');
  if (entry.state === 'boutique') {
    const node = el('a', 'grid-state ok', '✓ En stock au prix boutique · ' + euro.format(entry.price) + (entry.seller && !/^(Auchan|E\.Leclerc)$/.test(entry.seller) ? ' (vendu par ' + entry.seller + ')' : ''));
    node.href = entry.url; node.target = '_blank'; node.rel = 'noopener noreferrer';
    return node;
  }
  if (entry.state === 'revendeurs') return el('span', 'grid-state resale-only', 'Revendeurs seulement · dès ' + euro.format(entry.price));
  return el('span', 'grid-state none', 'Rien en ligne');
}

function priceGrid() {
  const feed = signalsFeed;
  if (!feed?.catalog?.length) return [empty('radar', 'Grille en cours de chargement', 'Elle apparaît après le prochain passage du collecteur.')];
  const sets = [...new Set(feed.catalog.map(product => product.set))];
  return [
    el('div', 'data-note', icon('search'), el('div', '',
      el('strong', '', 'Prix boutique, pas prix revendeur'),
      el('p', '', 'Auchan et Leclerc sont lus automatiquement (dernière lecture ' + ago(feed.generatedAt) + '). Fnac, Cultura, Carrefour et les autres bloquent les robots : vérifie en un tap, puis choisis ton magasin sur leur site pour voir le stock près de chez toi. Aucune enseigne ne publie les quantités.'))),
    ...sets.map(set => el('section', 'section',
      sectionTitle(set),
      el('div', 'record-grid', ...feed.catalog.filter(product => product.set === set).map(product => {
        const row = feed.grid?.[product.id] ?? {};
        const market = feed.market?.[product.id];
        const margin = market ? Math.round((market.median - product.price) * 100) / 100 : null;
        const query = 'pokemon ' + product.name.replace(/\(.*\)/, '');
        return el('article', 'record grid-card',
          el('div', 'record-top', badge(set, set === '30 ans' ? 'gold' : 'mint'),
            el('strong', 'price', (product.approx ? '≈ ' : '') + euro.format(product.price))),
          el('h3', '', product.name),
          el('p', 'mini muted', 'Prix boutique de référence' + (product.approx ? ' (estimé)' : '')),
          market ? el('p', 'mini resale', 'Revente observée ~' + euro.format(market.median) + (margin > 0 ? ' → marge ~+' + euro.format(margin) + ' par pièce' : '')) : null,
          el('div', 'grid-rows',
            el('div', 'grid-row', el('strong', '', 'Auchan'), gridState(row.Auchan)),
            el('div', 'grid-row', el('strong', '', 'Leclerc'), gridState(row['E.Leclerc']))),
          el('p', 'mini muted', 'Vérifier en un tap :'),
          el('div', 'chips check-links', ...CHECK_SHOPS.map(([name, url]) => {
            const node = el('a', 'badge lavender', name);
            node.href = url(query); node.target = '_blank'; node.rel = 'noopener noreferrer';
            return node;
          })));
      }))))
  ];
}









function stockCard({ row, status }) {
  const tone = status === 'Disponible signalé' ? 'mint' : status === 'Indisponible signalé' ? 'rose' : 'gold';
  return el('article', 'record',
    el('div', 'record-top', badge(status, tone), row.price === null ? null : el('strong', 'price', euro.format(row.price))),
    el('h3', '', row.product),
    el('p', 'muted', row.store + ' · ' + row.method),
    row.detail ? el('p', 'mini muted', row.detail) : null,
    el('p', 'mini muted', fullDate.format(new Date(row.checked)) + (status.startsWith('Relevé ') ? ' · ' + row.state : '')),
    el('div', 'actions', row.url ? out('Fiche produit', row.url) : null,
      button('Nouveau relevé', () => editStock(row.product, row.store), { variant: 'quiet' }),
      button('Supprimer', () => removeRecord('stocks', row.id, 'ce relevé'), { variant: 'quiet' }))
  );
}


function backups() {
  const picker = el('input', '');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.disabled = !db;
  const status = el('p', 'muted');
  const offline = el('p', 'mini muted', offlineState);
  offline.id = 'offline-status';
  offline.setAttribute('role', 'status');
  status.setAttribute('role', 'status');
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    try {
      const incoming = decodeBackup((await file.text()).replace(/^\uFEFF/, ''));
      let count = 0;
      await change(current => {
        const result = mergeData(current, incoming);
        count = ['stocks', 'prices', 'alerts', 'followed', 'customRaffles', 'calendar'].reduce((sum, key) => sum + result[key].length - current[key].length, 0);
        return result;
      });
      status.textContent = count ? count + ' entrée(s) ajoutée(s) au carnet.' : 'Toutes les entrées sont déjà présentes.';
    } catch (error) {
      status.textContent = 'Import interrompu. ' + error.message;
    } finally {
      picker.value = '';
    }
  });
  return [
    heading('Mes données', 'Sauvegarde ton carnet et retrouve-le dans un autre navigateur.'),
    el('section', 'panel section', sectionTitle('Exporter ou importer'),
      el('p', 'muted', 'Le carnet est enregistré sur cet appareil. Une sauvegarde JSON permet de transporter les stocks, prix, règles et tirages suivis.'),
      el('div', 'actions', button('Exporter mon carnet', () => download('pokeradar-sauvegarde.json', JSON.stringify(data, null, 2), 'application/json'), { variant: 'primary', symbol: 'archive', disabled: !db })),
      el('label', 'field file-field', el('span', '', 'Importer un fichier JSON'), picker), status,
      el('p', 'mini muted', 'Pour reprendre le portail mobile v0.4, ouvre-le dans le navigateur d’origine, va dans « Mes disponibilités », touche « Exporter JSON », puis sélectionne ce fichier ici.')),
    el('section', 'panel section', sectionTitle('Installer sur iPhone'),
      el('p', 'muted', 'Depuis l’adresse HTTPS dans Safari, ouvre Partager, puis Sur l’écran d’accueil. Active « Ouvrir comme app web » si l’option s’affiche.'),
      offline,
      el('p', 'muted', 'Les pages des boutiques et les sources externes utilisent Internet.'),
      out('Guide Apple', 'https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios/27', 'quiet'))
  ];
}

// ——— Rentable ? ———
const SALE_FEES = 0.1; // ~10 % de frais à la revente (plateforme, envoi)
let calc = { product: '', price: '' };

function verdictFor(product, price, market) {
  if (!product || !Number.isFinite(price) || price <= 0) return null;
  const resale = market?.median ?? null;
  const net = resale === null ? null : Math.round((resale * (1 - SALE_FEES) - price) * 100) / 100;
  if (price > product.cap) {
    return { tone: 'rose', title: 'Passe ton chemin', text: 'Au-dessus du prix boutique (' + euro.format(product.price) + ') : c’est un prix de revendeur.', net };
  }
  if (net === null) return { tone: 'gold', title: 'Prix boutique', text: 'Bon prix d’achat. Pas encore assez d’offres de revente pour estimer la marge.', net };
  if (net >= 10) return { tone: 'mint', title: 'Achète', text: 'Marge estimée +' + euro.format(net) + ' par pièce après ~10 % de frais de vente.', net };
  return { tone: 'gold', title: 'Marge faible', text: 'Marge estimée ' + euro.format(net) + ' par pièce après frais : à garder pour collection plutôt que pour revendre.', net };
}

function calculator(feed) {
  const catalog = feed?.catalog ?? [];
  const result = el('div', 'calc-result');
  const select = el('select', '');
  select.id = 'calc-product';
  select.append(el('option', '', 'Choisis le produit'), ...catalog.map(product => {
    const option = el('option', '', product.name + ' · ' + product.set);
    option.value = product.id;
    option.selected = product.id === calc.product;
    return option;
  }));
  select.firstChild.value = '';
  const price = el('input', '');
  Object.assign(price, { id: 'calc-price', type: 'number', inputMode: 'decimal', min: '0', step: '0.01', placeholder: 'Prix affiché (€)', value: calc.price });
  const paint = () => {
    const product = catalog.find(item => item.id === calc.product);
    const full = product && { ...product, cap: product.cap ?? product.price * 1.18 };
    const market = product && feed.market?.[product.id];
    const verdict = verdictFor(full, Number(String(calc.price).replace(',', '.')), market);
    result.replaceChildren(...(!product ? [el('p', 'muted', 'Choisis un produit et tape le prix que tu vois en rayon ou sur le site.')] : [
      el('p', 'mini muted', 'Prix boutique ' + (product.approx ? '≈ ' : '') + euro.format(product.price) +
        (market ? ' · revente observée ~' + euro.format(market.median) + ' (' + market.n + ' offre' + (market.n > 1 ? 's' : '') + ')' : ' · revente pas encore observée')),
      verdict ? el('div', 'verdict ' + verdict.tone, el('strong', '', verdict.title), el('p', '', verdict.text)) : null
    ]));
  };
  select.addEventListener('change', () => { calc.product = select.value; paint(); });
  price.addEventListener('input', () => { calc.price = price.value; paint(); });
  paint();
  const labelled = (text, control) => { const label = el('label', 'calc-field', el('span', 'mini muted', text), control); return label; };
  return el('section', 'panel calc', sectionTitle('Ça vaut le coup ?'),
    el('div', 'calc-inputs', labelled('Produit', select), labelled('Prix vu', price)), result);
}

function rentable() {
  return [
    heading('Rentable ?', 'Le bon prix d’achat, la revente observée et où vérifier le stock en un tap.'),
    calculator(signalsFeed),
    ...priceGrid()
  ];
}

// ——— Mes magasins ———
const STORE_BRANDS = ['Fnac', 'Cultura', 'E.Leclerc', 'Auchan', 'Carrefour', 'Micromania', 'King Jouet', 'JouéClub', 'Smyths Toys', 'La Grande Récré'];

function quickSighting() {
  openEditor('J’ai vu du stock', [
    field('product', 'Produit', { required: true, maxLength: 160, placeholder: 'ETB 30 ans, Pokébox Nymphali…' }),
    field('store', 'Magasin et ville', { required: true, maxLength: 100, placeholder: 'Cultura La Défense' }),
    field('state', 'Ce que tu as vu', { values: ['Disponible signalé', 'Indisponible signalé', 'Inconnu'] }),
    field('price', 'Prix (€), si affiché', { type: 'number' }),
    field('method', 'Comment', { values: ['Observé en rayon', 'Appel téléphonique', 'Page du magasin', 'Retrait préparé'] })
  ], values => addRecord('stocks', stockRecord({ ...values, id: id(), checked: new Date().toISOString() })),
  { description: 'La date et l’heure sont ajoutées automatiquement : c’est ce qui permet de trouver les jours de réassort de tes magasins.' });
}

function magasins() {
  const results = el('div', 'record-grid');
  const rows = stockObservations(data.stocks).filter(item => item.status !== 'Relevé remplacé');
  results.replaceChildren(...(rows.length ? rows.map(stockCard) : [empty('pin', 'Aucun repérage pour l’instant',
    'Chaque fois que tu passes dans un magasin ou que tu appelles, note-le en 2 secondes : en quelques semaines tu sauras quels jours y aller.')]));
  const mine = Object.entries(myPatterns());
  const publicTrends = Object.entries(signalsFeed?.patterns ?? {}).filter(([, entry]) => entry.n >= 2).slice(0, 8);
  const zone = field('zone', 'Ville ou code postal', { value: localZone, maxLength: 100 });
  const brands = el('div', 'chips check-links');
  const paintBrands = () => brands.replaceChildren(...STORE_BRANDS.map(brand => {
    const node = el('a', 'badge lavender', brand);
    node.href = mapUrl(brand + ' près de ' + localZone); node.target = '_blank'; node.rel = 'noopener noreferrer';
    return node;
  }));
  zone.querySelector('input').addEventListener('input', event => { localZone = event.target.value.trim() || 'Suresnes'; paintBrands(); });
  paintBrands();
  return [
    heading('Mes magasins', 'Tes repérages, les meilleurs jours de chaque magasin, et les numéros pour appeler avant de te déplacer.',
      button('J’ai vu du stock', quickSighting, { variant: 'primary', symbol: 'plus', disabled: !db })),
    el('section', 'section', sectionTitle('Meilleurs jours'),
      mine.length ? el('div', 'trend-list', ...mine.map(trendRow)) :
        el('p', 'muted', 'Apparaît dès tes premiers repérages « Disponible ». Plus tu notes, plus c’est précis.')),
    el('section', 'panel', sectionTitle('Trouver et appeler'),
      el('div', 'inline-form', zone),
      el('p', 'mini muted', 'Ouvre la carte : adresse, horaires et téléphone de chaque magasin. Appelle avant de te déplacer.'),
      brands),
    el('section', 'section', sectionTitle('Mes derniers repérages'), results),
    publicTrends.length ? el('section', 'section',
      sectionTitle('Tendances des grandes enseignes'),
      el('p', 'mini muted', 'D’après les signalements publics des 60 derniers jours.'),
      el('div', 'trend-list', ...publicTrends.map(trendRow))) : null
  ];
}

const views = { accueil: home, rentable, magasins, donnees: backups };
for (const [key, [label, , symbol]] of Object.entries(ROUTES)) {
  if (key === 'donnees') continue;
  const item = el('a', 'nav-link', icon(symbol), el('span', '', label));
  item.href = '#' + key;
  item.dataset.route = key;
  navigation.append(item);
}

function render() {
  watchRenderPending = false;
  const active = route();
  document.querySelector('#breadcrumb').textContent = ROUTES[active][1];
  for (const item of navigation.children) {
    if (item.dataset.route === active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  screen.replaceChildren(...views[active]().filter(Boolean));
}

function renderWhenIdle() {
  if (editor.open || screen.contains(document.activeElement) && document.activeElement.matches('input, select, textarea, button, a, summary')) {
    watchRenderPending = true;
    return;
  }
  render();
}

function restoreWatch() {
  try { watch = decodeWatch(JSON.parse(localStorage.getItem(watchKey))); } catch {}
}

function refreshWatch() {
  if (watchLoading) return watchLoading;
  watchStatus.textContent = 'Chargement du dernier relevé…';
  watchRefresh.disabled = true;
  watchLoading = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('./veille.json', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Relevé indisponible');
      const next = decodeWatch(await response.json());
      const [health, feed, radar] = await Promise.all(['./sante.json', './evenements.json', './signaux.json'].map(async path => {
        try {
          const res = await fetch(path, { cache: 'no-store', signal: controller.signal });
          return res.ok ? await res.json() : null;
        } catch { return null; }
      }));
      const nextHealth = health && typeof health.hosts === 'object' && health.hosts ? health : null;
      const nextEvents = Array.isArray(feed?.events) ? feed.events.filter(event => event && typeof event.at === 'string' &&
        Number.isFinite(Date.parse(event.at)) && ['seller', 'product', 'type'].every(key => typeof event[key] === 'string')) : null;
      const nextRadar = radar && Array.isArray(radar.signals) ? {
        ...radar,
        signals: radar.signals.filter(item => item && typeof item.title === 'string' && typeof item.at === 'string' && Array.isArray(item.targets)),
        available: Array.isArray(radar.available) ? radar.available.filter(item => item && typeof item.title === 'string' && Array.isArray(item.targets)) : []
      } : null;
      const changedRadar = Boolean(nextRadar) && nextRadar.generatedAt !== signalsFeed?.generatedAt;
      signalsFeed = nextRadar ?? signalsFeed;
      const changed = JSON.stringify(next) !== JSON.stringify(watch) ||
        JSON.stringify([nextHealth, nextEvents]) !== JSON.stringify([collectorHealth, collectorEvents]);
      collectorHealth = nextHealth;
      collectorEvents = nextEvents;
      watch = next;
      try { localStorage.setItem(watchKey, JSON.stringify(watch)); } catch {}
      const latest = watch.offers.filter(row => row.status !== 'unknown')
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      watchStatus.textContent = signalsFeed?.generatedAt ? 'Radar mis à jour ' + ago(signalsFeed.generatedAt) : latest ? 'Dernier relevé · ' + offerDate(latest) : 'Radar en attente du premier passage.';
      if (changed || changedRadar) renderWhenIdle();
    } catch {
      watchStatus.textContent = watch.offers.length ?
        'Actualisation indisponible · dernier relevé conservé.' : 'Relevé indisponible · réessaie avec Internet.';
    } finally {
      clearTimeout(timer);
      watchRefresh.disabled = false;
      watchLoading = null;
    }
  })();
  return watchLoading;
}

watchRefresh.addEventListener('click', refreshWatch);
window.addEventListener('online', refreshWatch);
window.addEventListener('pageshow', event => { if (event.persisted) refreshWatch(); });
screen.addEventListener('focusout', () => {
  setTimeout(() => { if (watchRenderPending) renderWhenIdle(); }, 0);
});
editor.addEventListener('close', () => { if (watchRenderPending) renderWhenIdle(); });

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('pokeradar') : null;
async function refreshData() {
  if (!db) return;
  try {
    data = await access(db);
    if (route() !== 'donnees') renderWhenIdle();
  } catch (error) { announce(error.message); }
}
if (channel) channel.onmessage = refreshData;
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  render();
  screen.querySelector('h1')?.setAttribute('tabindex', '-1');
  screen.querySelector('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshData();
    refreshWatch();
  }
});
setInterval(() => { if (!document.hidden) refreshWatch(); }, 5 * 60 * 1000);
setInterval(() => {
  if (document.hidden || editor.open || document.activeElement?.matches('input, select, button, a')) return;
  if (['accueil', 'stocks', 'boutiques', 'alertes'].includes(route())) render();
}, 60000);
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main').focus();
});

async function start() {
  const errorBox = document.querySelector('#storage-error');
  restoreWatch();
  try {
    db = await openStorage();
    try { await migratePortal(db); } catch {
      errorBox.textContent = 'L’ancien carnet est toujours présent. Pour le reprendre, utilise son export JSON dans Mes données.';
      errorBox.hidden = false;
    }
    data = await access(db);
  } catch {
    db?.close();
    db = undefined;
    errorBox.textContent = 'Le stockage de cet appareil est indisponible. Tu peux consulter les liens, puis recharger l’application pour réessayer.';
    errorBox.hidden = false;
  }
  render();
  refreshWatch();
  const showOffline = state => {
    offlineState = state;
    const status = document.querySelector('#offline-status');
    if (status) status.textContent = state;
  };
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => {
        if (navigator.onLine) registration.update().catch(() => {});
        return navigator.serviceWorker.ready;
      })
      .then(() => showOffline('Le carnet est prêt pour une consultation hors ligne.'))
      .catch(() => showOffline('Mode hors ligne indisponible dans ce navigateur.'));
  } else {
    showOffline('L’accès hors ligne nécessite un navigateur compatible et une adresse HTTPS.');
  }
}

start();
