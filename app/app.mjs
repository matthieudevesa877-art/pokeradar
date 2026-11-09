import { LOCAL_STORES, SOURCES, RAFFLES, TRACKERS } from './catalog.mjs';
import {
  alertMatches, alertRecord, calendarFile, customRaffleRecord, decodeBackup, emptyData, ENTRY_STATES, mapUrl, marginEstimate,
  marketSummary, mergeData, METHODS, newest, normalize, participationRecord, PRICE_KINDS, priceRecord, RAFFLE_CATEGORIES, raffleStatus,
  searchUrl, STOCK_STATES, stockObservations, stockRecord
} from './domain.mjs';
import { access, migratePortal, openStorage } from './storage.mjs';
import { decodeWatch, mergeWatchEntries, offerIsRecent, recentWatchStocks } from './watch.mjs';

const ROUTES = {
  accueil: ['Radar', 'Vue d’ensemble', 'radar'],
  marche: ['Marché', 'Prix et marge', 'chart'],
  boutiques: ['Boutiques', 'Boutiques et tirages', 'bag'],
  stocks: ['Stocks', 'Stocks locaux', 'pin'],
  alertes: ['Alertes', 'Alertes et suivi', 'bell'],
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
const RADAR_ALERTS = 'https://radarstock.fr/alertes/pokemon/';
const ANNIVERSARY_SCAN = './achats-30-ans.html';
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
const filters = { shops: 'Toutes', draws: 'Toutes', stock: 'Tous', price: 'Tous' };
let shopQuery = 'Pokémon JCC Règne Delta FR';
let watchQuery = '';
let watchFilter = 'Toutes';
let priceQuery = '';
let localZone = 'Suresnes';
let marginInputs = { buy: '60', shipping: '5', sell: '85', fees: '5', other: '3' };
let data = emptyData();
let db;
let feedbackTimer;
let offlineState = 'Préparation du mode hors ligne…';
let watch = { offers: [], campaigns: [], releases: [] };
let watchLoading;
let watchRenderPending = false;
let collectorHealth = null;
let collectorEvents = null;

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
  return link(label, href, { variant, symbol: 'external' });
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

function route() {
  const key = location.hash.slice(1).split('/')[0];
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

function editPrice(product = '') {
  openEditor('Nouveau relevé de prix', [
    field('product', 'Produit et variante', { required: true, maxLength: 160, value: product, placeholder: 'ETB Règne Delta FR' }),
    field('source', 'Enseigne ou plateforme', { required: true, maxLength: 100, placeholder: 'Cardmarket' }),
    field('kind', 'Type de prix', { values: PRICE_KINDS }),
    field('price', 'Prix de l’article (€)', { type: 'number', required: true }),
    field('shipping', 'Livraison (€), si connue', { type: 'number', placeholder: '0 si livraison gratuite' }),
    field('url', 'Lien de la source', { type: 'url', required: true, maxLength: 2048 })
  ], values => addRecord('prices', priceRecord({ ...values, id: id(), checked: new Date().toISOString() })),
  { description: 'Indique la langue, l’édition et le format. La date et le lien restent visibles dans l’historique.' });
}

function editAlert(product = '', type = 'stock') {
  const typeField = field('type', 'Déclencheur', { values: ['Disponibilité', 'Prix total sous un seuil'], value: type === 'price' ? 'Prix total sous un seuil' : 'Disponibilité' });
  const limit = field('max', 'Budget livraison comprise (€)', { type: 'number', required: true });
  const selector = typeField.querySelector('select');
  const update = () => {
    limit.hidden = selector.value === 'Disponibilité';
    limit.querySelector('input').disabled = limit.hidden;
  };
  selector.addEventListener('change', update);
  update();
  openEditor('Créer une alerte', [
    field('product', 'Produit et variante', { required: true, maxLength: 160, value: product, placeholder: 'ETB Règne Delta FR' }),
    typeField, limit
  ], values => addRecord('alerts', alertRecord({
    id: id(), product: values.product, type: values.type === 'Disponibilité' ? 'stock' : 'price', max: values.max
  })), { description: 'Le nom doit correspondre au relevé. Les alertes s’affichent ici pour les relevés de moins de 24 h.' });
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

function publicRaffles() {
  return mergeWatchEntries(RAFFLES, watch.campaigns);
}

function currentAlerts() {
  return alertMatches({ ...data, stocks: [...data.stocks, ...recentWatchStocks(watch.offers)] });
}

function offerDate(row) {
  return row.observedAt.length === 10 ? dateOnly.format(new Date(row.observedAt + 'T12:00:00Z')) :
    fullDate.format(new Date(row.observedAt));
}

function watchCard(row) {
  const recent = offerIsRecent(row);
  const status = row.status === 'unknown' ? 'À vérifier' : !recent ? 'À revérifier' :
    { available: row.details === 'Retrait uniquement' ? 'Retrait affiché' : 'Disponible sur la fiche', invitation: 'Invitation affichée', unavailable: 'Indisponible sur la fiche' }[row.status];
  return el('article', 'record',
    el('div', 'record-top', badge(status, recent ? (row.status === 'available' ? 'mint' : 'lavender') : 'gold'),
      row.price === null ? null : el('strong', 'price', euro.format(row.price))),
    el('h3', '', row.product),
    el('p', 'muted', row.seller + (row.status === 'invitation' && !recent ? ' · lien d’invitation' : '')),
    el('p', 'muted mini', 'Relevé du ' + offerDate(row) + (row.price === null ? '' : ' · prix hors port')),
    row.pickup.length ? el('p', 'mini', (recent ? 'Retrait affiché · ' : 'Retrait au dernier relevé · ') + row.pickup.join(', ')) : null,
    row.details ? el('p', 'mini muted', row.details) : null,
    el('div', 'actions', out(row.status === 'invitation' ? 'Vérifier l’invitation' : 'Voir chez le marchand', row.url)));
}

const EVENT_LABELS = { restock: 'Réassort', available: 'Disponible', soldout: 'Rupture', price: 'Prix', invitation: 'Invitation', pickup: 'Retrait' };

function collectorPanel() {
  const hosts = Object.entries(collectorHealth?.hosts ?? {});
  const events = (collectorEvents ?? []).slice(0, 8);
  if (!hosts.length && !events.length) {
    return el('p', 'mini muted', 'Collecteur automatique : aucun passage enregistré pour l’instant.');
  }
  const stateClass = { ok: 'mint', partiel: 'gold', bloqué: 'gold', 'en panne': 'gold' };
  return el('div', 'collector',
    el('h3', '', 'Santé du collecteur'),
    el('p', 'mini muted', collectorHealth?.generatedAt ?
      'Dernier passage le ' + fullDate.format(new Date(collectorHealth.generatedAt)) +
      (collectorHealth.source ? ' · publié par ' + (collectorHealth.source === 'github' ? 'GitHub' : 'ton PC') : '') : 'Date du dernier passage inconnue.'),
    el('div', 'chips', ...hosts.map(([host, entry]) => badge(
      host.replace(/^www\./, '') + ' · ' + entry.state + (entry.lastOkAt ? ' · ' + fullDate.format(new Date(entry.lastOkAt)) : ''),
      stateClass[entry.state] ?? 'lavender'))),
    events.length ? el('h3', '', 'Derniers changements') : null,
    ...events.map(event => el('p', 'mini',
      fullDate.format(new Date(event.at)) + ' · ' + (EVENT_LABELS[event.type] ?? event.type) + ' · ' + event.seller + ' · ' + event.product +
      (event.type === 'price' ? ` (${euro.format(event.from)} → ${euro.format(event.to)})` : event.type === 'pickup' ? ' · ' + event.to : ''))));
}

function watchPanel(mode = 'preview') {
  const all = mode === 'all';
  const available = watch.offers.filter(row => mode !== 'pickup' || row.pickup.length);
  const ordered = available.sort((a, b) => Number(offerIsRecent(b)) - Number(offerIsRecent(a)));
  const preview = mode === 'preview' ? [
    ...ordered.filter(row => row.status !== 'invitation').slice(0, 2),
    ...ordered.filter(row => row.status === 'invitation').slice(0, 2)
  ] : ordered.slice(0, 3);
  const results = el('div', 'record-grid');
  const search = all ? field('watch', 'Chercher un produit, une boutique ou un magasin', {
    type: 'search', value: watchQuery, placeholder: 'Ex. Noctali, ETB, UltraJeux'
  }) : null;
  const labels = ['Toutes', 'Achat direct', 'Invitations', 'Retrait', 'À revérifier'];
  const paint = () => {
    const rows = !all ? preview : ordered.filter(row => {
      const include = watchFilter === 'Toutes' || (watchFilter === 'Achat direct' && row.status === 'available') ||
        (watchFilter === 'Invitations' && row.status === 'invitation') || (watchFilter === 'Retrait' && row.pickup.length) ||
        (watchFilter === 'À revérifier' && !offerIsRecent(row));
      return include && normalize([row.product, row.seller, ...row.pickup].join(' ')).includes(normalize(watchQuery));
    });
    results.replaceChildren(...(rows.length ? rows.map(watchCard) : [empty('search', 'Aucune fiche à afficher',
      watch.offers.length ? 'Essaie un autre filtre.' : 'Actualise la veille pour charger les fiches publiques.')]));
  };
  search?.querySelector('input').addEventListener('input', event => { watchQuery = event.target.value; paint(); });
  const bar = all ? filterBar(labels, watchFilter, value => { watchFilter = value; paint(); }) : null;
  paint();
  return el('section', 'section watch-panel', sectionTitle(mode === 'pickup' ? 'Retraits affichés par les boutiques' : 'Offres Pokémon 30 ans',
    all ? null : link('Voir toutes les fiches', '#boutiques/veille', { variant: 'quiet', symbol: 'arrow' })),
    el('p', 'muted', 'Les prix et stocks correspondent aux fiches consultées. Après six heures, vérifie à nouveau sur le site marchand.'),
    search, bar, results, all ? collectorPanel() : null);
}

function home() {
  const matches = currentAlerts().filter(item => item.rows.length).length;
  const watchCount = data.alerts.length + data.followed.length;
  const campaigns = publicRaffles().filter(row => raffleStatus(row) === 'Annoncé par l’enseigne');
  const artwork = el('img', 'hero-art');
  artwork.src = './assets/field.svg';
  artwork.alt = '';
  return [
    heading('Ton radar Pokémon', 'Invitations, prix et stocks avec leur dernière vérification.'),
    ...campaigns.map(campaign => el('div', 'campaign',
      el('span', 'tile', icon('ticket')),
      el('div', '', el('strong', '', campaign.brand + ' · ' + campaign.title), el('p', 'muted mini',
        [campaign.deadlineLabel, campaign.verified && ('Source consultée le ' + dateOnly.format(new Date(campaign.verified + 'T12:00:00Z')))].filter(Boolean).join(' · '))),
      out('Formulaire officiel', campaign.url))),
    watchPanel(),
    el('div', 'home-grid',
      el('section', 'hero',
        el('div', 'hero-text', el('p', 'hero-label', icon('radar'), 'Ton carnet Pokémon JCC'),
          el('h2', '', 'Le carnet des collectionneurs'),
          el('p', 'hero-description', 'Compare tes prix, repère les boutiques et garde tes prochains tirages en vue.'),
          link('Explorer le marché', '#marche', { variant: 'gold-button', symbol: 'arrow' })
        ), artwork),
      el('section', 'snapshot',
        sectionTitle('Ma veille', el('span', 'tile', icon('bell'))),
        el('div', 'snapshot-row', el('span', '', 'Prix relevés'), el('strong', '', String(data.prices.length))),
        el('div', 'snapshot-row', el('span', '', 'Relevés de stock'), el('strong', '', String(data.stocks.length))),
        el('div', 'snapshot-row', el('span', '', 'Alertes et tirages suivis'), el('strong', '', String(watchCount))),
        link(matches ? matches + ' alerte(s) à consulter' : 'Ouvrir ma veille', '#alertes', { variant: 'quiet', symbol: 'arrow' }))
    ),
    el('div', 'data-note', icon('search'), el('div', '',
      el('strong', '', 'Archive du 7 novembre'),
      link('Ouvrir le scan d’origine', ANNIVERSARY_SCAN, { variant: 'quiet', symbol: 'arrow' }))),
    el('section', 'section',
      sectionTitle('Le calendrier Pokémon', link('Tirages et invitations', '#boutiques/tirages', { variant: 'quiet', symbol: 'ticket' })),
      el('div', 'release-grid', [...mergeWatchEntries(RELEASES, watch.releases), ...data.calendar].sort((a, b) => a.date.localeCompare(b.date)).map(releaseCard))),
    el('div', 'data-note', icon('radar'),
      el('div', '', el('strong', '', 'Des relevés datés'), el('p', '', 'Le carnet personnel conserve tes propres relevés. Ouvre la fiche marchande avant de te déplacer ou de commander.')))
  ];
}

function market() {
  const listing = el('div', 'listing');
  const query = field('product', 'Filtrer par produit, édition ou langue', { type: 'search', value: priceQuery, placeholder: 'Ex. ETB Règne Delta FR' });
  const paint = () => {
    const matches = newest(data.prices).filter(row => normalize(row.product).includes(normalize(priceQuery)));
    const summary = marketSummary(matches);
    const rows = matches.filter(row => filters.price === 'Tous' || row.kind === filters.price);
    listing.replaceChildren(
      summary ? el('div', 'market-metrics',
        el('div', '', el('p', '', 'Médiane des ventes relevées'), el('strong', '', summary.sold === null ? '—' : euro.format(summary.sold)),
          el('small', '', summary.soldCount + ' vente(s) · hors livraison')),
        el('div', '', el('p', '', 'Meilleur prix relevé'), el('strong', '', summary.asking === null ? '—' : euro.format(summary.asking)),
          el('small', '', summary.askingCount + ' offre(s) · livraison comprise'))) : '',
      summary && (filters.price === 'Tous' || filters.price === 'Vente réalisée') ? priceTimeline(matches) : null,
      el('div', 'record-grid', rows.length ? rows.map(priceCard) : empty('chart', 'Aucun prix à afficher',
        data.prices.length ? 'Essaie un autre produit ou type de prix.' : 'Relève une annonce, un prix boutique ou une vente réalisée pour commencer.'))
    );
  };
  query.querySelector('input').addEventListener('input', event => { priceQuery = event.target.value; paint(); });
  const bar = filterBar(['Tous', ...PRICE_KINDS], filters.price, value => { filters.price = value; paint(); });
  paint();
  return [
    heading('Marché Pokémon', 'Compare une même référence et garde l’historique de tes prix.', button('Relever un prix', () => editPrice(priceQuery), { variant: 'primary', symbol: 'plus', disabled: !db })),
    el('div', 'data-note', icon('chart'), el('div', '', el('strong', '', 'Repères de marché'), el('p', '', 'Un prix d’annonce et une vente réalisée sont comptés séparément. Les statistiques portent sur tes relevés pour une même référence.'),
      el('div', 'actions', out('Consulter Cardmarket', 'https://www.cardmarket.com/fr/Pokemon/Products', 'quiet'),
        out('Repères de prix publics', 'https://radarstock.fr/prix-publics/', 'quiet'),
        link('Comparer les offres relevées', '#boutiques/veille', { variant: 'quiet', symbol: 'arrow' })))),
    el('section', 'section', sectionTitle('Historique des prix'), query, bar, listing),
    marginCard()
  ];
}

function priceTimeline(rows) {
  const sales = rows.filter(row => row.kind === 'Vente réalisée').slice(0, 10).reverse();
  if (sales.length < 2) return null;
  const values = sales.map(row => row.price);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const start = Date.parse(sales[0].checked);
  const end = Date.parse(sales.at(-1).checked);
  const dots = sales.map((row, index) => {
    const x = end === start ? index / (sales.length - 1) : (Date.parse(row.checked) - start) / (end - start);
    const y = low === high ? .5 : (high - row.price) / (high - low);
    return [8 + x * 384, 8 + y * 60];
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 76');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(svg.namespaceURI, 'polyline');
  line.setAttribute('points', dots.map(dot => dot.join(',')).join(' '));
  svg.append(line);
  for (const [x, y] of dots) {
    const dot = document.createElementNS(svg.namespaceURI, 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', '3');
    svg.append(dot);
  }
  return el('figure', 'timeline',
    el('figcaption', '', 'Dernières ventes relevées · ' + euro.format(low) + ' à ' + euro.format(high) + ' hors livraison'),
    svg, el('div', 'timeline-dates', dateOnly.format(new Date(start)), el('span', '', dateOnly.format(new Date(end)))));
}

function priceCard(row) {
  const price = row.shipping === null ? euro.format(row.price) : euro.format(row.price + row.shipping);
  return el('article', 'record',
    el('div', 'record-top', badge(row.kind, row.kind === 'Vente réalisée' ? 'mint' : 'lavender'), el('strong', 'price', price)),
    el('h3', '', row.product),
    el('p', 'muted', row.source + ' · ' + fullDate.format(new Date(row.checked))),
    row.kind === 'Vente réalisée' || row.kind === 'Vente à vérifier' || row.kind === 'Cote indicative' ? null :
      el('p', 'mini muted', row.shipping === null ? 'Livraison non renseignée' : 'Livraison incluse · ' + euro.format(row.shipping)),
    row.detail ? el('p', 'mini muted', row.detail) : null,
    el('div', 'actions', row.url ? out('Source du prix', row.url) : null,
      button('Supprimer', () => removeRecord('prices', row.id, 'ce relevé'), { variant: 'quiet' }))
  );
}

function marginCard() {
  const inputs = [
    field('buy', 'Prix d’achat (€)', { type: 'number', value: marginInputs.buy }),
    field('shipping', 'Livraison achat (€)', { type: 'number', value: marginInputs.shipping }),
    field('sell', 'Revente envisagée (€)', { type: 'number', value: marginInputs.sell }),
    field('fees', 'Commission de vente (%)', { type: 'number', value: marginInputs.fees, max: '100' }),
    field('other', 'Autres frais, dont l’envoi (€)', { type: 'number', value: marginInputs.other })
  ];
  const result = el('div', 'margin-result');
  result.setAttribute('aria-live', 'polite');
  const form = el('form', '', el('div', 'form-grid', inputs), result);
  const refresh = () => {
    marginInputs = Object.fromEntries(new FormData(form));
    try {
      const estimate = marginEstimate(marginInputs);
      result.replaceChildren(
        el('p', '', 'Gain estimé par unité'), el('strong', '', euro.format(estimate.gain)),
        el('p', '', estimate.ratio === null ? 'Coût total nul' : 'Rendement sur coût total · ' + number.format(estimate.ratio) + ' %'),
        el('p', '', estimate.breakEven === null ? 'Seuil indisponible avec 100 % de commission' : 'Prix de revente à l’équilibre · ' + euro.format(estimate.breakEven))
      );
    } catch (error) {
      result.textContent = error.message;
    }
  };
  form.addEventListener('input', refresh);
  form.addEventListener('submit', event => event.preventDefault());
  refresh();
  return el('section', 'section panel', sectionTitle('Calculer une marge'), el('p', 'muted', 'Simulation à partir de tes hypothèses et des frais renseignés.'), form);
}

function boutiques() {
  const section = location.hash.split('/')[1];
  const shopLink = link('Où acheter', '#boutiques', { variant: 'chip', symbol: 'bag' });
  const drawLink = link('Tirages et invitations', '#boutiques/tirages', { variant: 'chip', symbol: 'ticket' });
  const watchLink = link('Offres 30 ans', '#boutiques/veille', { variant: 'chip', symbol: 'search' });
  (section === 'tirages' ? drawLink : section === 'veille' ? watchLink : shopLink).setAttribute('aria-current', 'page');
  return [
    heading('Boutiques et tirages', 'Trouve les pages d’achat, les conditions d’accès et les formulaires officiels.'),
    el('nav', 'subnav', watchLink, drawLink, shopLink),
    section === 'tirages' ? raffleDirectory() : section === 'veille' ? watchPanel('all') : shopDirectory()
  ];
}

function shopDirectory() {
  const list = el('div', 'record-grid');
  const input = field('search', 'Chercher par produit ou EAN', { type: 'search', value: shopQuery, maxLength: 160 });
  const paint = () => list.replaceChildren(...SOURCES.filter(source => filters.shops === 'Toutes' || source.group === filters.shops).map(source =>
    el('article', 'record',
      el('div', 'record-top', badge(source.group), el('span', 'tile small', icon('bag'))),
      el('h3', '', source.name),
      el('p', 'muted', source.warning || 'Vérifie le vendeur, le prix et la disponibilité sur la fiche.'),
      el('div', 'actions', out(source.strategy === 'category' || !shopQuery.trim() ? 'Ouvrir' : 'Chercher', searchUrl(source, shopQuery.trim())),
        source.local ? out('Sur la carte', mapUrl(source.name + ' près de ' + localZone), 'quiet') : null))));
  input.querySelector('input').addEventListener('input', event => { shopQuery = event.target.value; paint(); });
  const bar = filterBar(['Toutes', ...new Set(SOURCES.map(source => source.group))], filters.shops, value => { filters.shops = value; paint(); });
  paint();
  return el('section', 'section', sectionTitle(SOURCES.length + ' sources d’achat'), input, bar, list);
}

function isArchivedRaffle(status) {
  return ['Clôturé', 'Date dépassée', 'Signalé'].includes(status);
}

function raffleDirectory() {
  const list = el('div', 'record-grid');
  const raffles = [...publicRaffles(), ...data.customRaffles];
  const categories = ['Toutes', ...new Set(raffles.map(row => row.category)), 'Archives'];
  const paint = () => list.replaceChildren(...raffles.filter(row => {
    const archived = isArchivedRaffle(raffleStatus(row));
    if (filters.draws === 'Archives') return archived;
    return !archived && (filters.draws === 'Toutes' || row.category === filters.draws);
  }).map(raffleCard));
  const bar = filterBar(categories, filters.draws, value => { filters.draws = value; paint(); });
  paint();
  return el('section', 'section',
    sectionTitle('Tirages, invitations et concours', out('Répertoire Radar Stock', 'https://radarstock.fr/pokemon/tirages/', 'quiet')),
    el('p', 'muted', 'Vérifie l’ouverture et les conditions sur la page de l’enseigne. Les anciennes campagnes Fnac+, Micromania et Amazon sont dans les archives.'),
    el('div', 'actions', button('Ajouter un tirage', editRaffle, { variant: 'secondary', symbol: 'plus', disabled: !db }),
      link('Invitations Amazon par produit', '#boutiques/veille', { variant: 'quiet' })),
    bar, list,
    el('details', 'panel details', el('summary', '', 'Autres pages à surveiller'),
      TRACKERS.map(([label, url, description]) => el('div', 'tracker-row', el('div', '', el('strong', '', label), el('p', 'muted', description)), out('Ouvrir', url))))
  );
}

function editRaffle() {
  openEditor('Ajouter un tirage', [
    field('brand', 'Enseigne', { maxLength: 100, required: true }),
    field('title', 'Nom de la campagne', { maxLength: 180, required: true }),
    field('category', 'Type de campagne', { values: RAFFLE_CATEGORIES }),
    field('url', 'Lien officiel', { type: 'url', maxLength: 2048, required: true }),
    field('requirements', 'Conditions', { maxLength: 300 }),
    field('deadline', 'Clôture (heure locale)', { type: 'datetime-local' })
  ], values => addRecord('customRaffles', customRaffleRecord({ ...values, id: id() })));
}

function editParticipation(row, previous) {
  openEditor('Mon inscription', [
    field('status', 'Statut personnel', { values: ENTRY_STATES, value: previous?.status ?? 'Non inscrit' }),
    field('note', 'Note personnelle', { maxLength: 500, value: previous?.note })
  ], values => change(current => ({
    ...current, followed: [...current.followed.filter(item => item.id !== row.id), participationRecord({ ...values, id: row.id })]
  })));
}

function raffleCard(row) {
  const status = raffleStatus(row);
  const archived = isArchivedRaffle(status);
  const followed = data.followed.find(item => item.id === row.id);
  const personal = data.customRaffles.some(item => item.id === row.id);
  const toggle = async () => {
    if (followed?.status) {
      openEditor('Retirer ce suivi ?', [], () => change(current => ({
        ...current, followed: current.followed.filter(item => item.id !== row.id)
      })), { submit: 'Supprimer', description: 'Ton statut d’inscription et ta note seront retirés du carnet.' });
      return;
    }
    try {
      await change(current => ({
        ...current,
        followed: current.followed.some(item => item.id === row.id) ?
          current.followed.filter(item => item.id !== row.id) : [...current.followed, { id: row.id }]
      }));
      render();
      announce(followed ? 'Tirage retiré du suivi.' : 'Tirage ajouté à ta veille.');
    } catch (error) { announce(error.message); }
  };
  const time = row.deadlineLabel ?? (row.releaseDate ? 'Sortie indicative · ' + dateOnly.format(new Date(row.releaseDate + 'T12:00:00Z')) :
    row.deadline ? 'Clôture annoncée · ' + fullDate.format(new Date(row.deadline)) : '');
  return el('article', 'record',
    el('div', 'record-top', badge(row.brand, 'lavender'), badge(status, archived ? 'neutral' : row.verified ? 'mint' : 'gold')),
    el('h3', '', row.title), el('p', 'muted', [row.method, row.requirements].filter(Boolean).join(' · ')),
    time ? el('p', 'mini', time) : null, el('p', 'muted', row.note),
    row.verified ? el('p', 'muted mini', 'Source consultée le ' + dateOnly.format(new Date(row.verified + 'T12:00:00Z'))) : null,
    followed?.status ? el('p', 'mini', 'Mon suivi · ' + followed.status, followed.note ? ' · ' + followed.note : '') : null,
    el('div', 'actions', out(status === 'Signalé' ? 'Voir le signalement' : archived ? 'Page archivée' : row.id === 'fnac-2026-11-13' ? 'Formulaire officiel' : 'Consulter la page', row.url),
      row.source !== row.url ? out('Source', row.source, 'quiet') : null,
      !archived || followed ? button('Mon inscription', () => editParticipation(row, followed), { variant: 'quiet', disabled: !db }) : null,
      !archived || followed ? button(followed ? 'Ne plus suivre' : 'Suivre', toggle, { variant: 'quiet', disabled: !db, symbol: 'bell' }) : null,
      personal ? button('Supprimer ce tirage', () => openEditor('Supprimer ce tirage ?', [], () => change(current => ({
        ...current, customRaffles: current.customRaffles.filter(item => item.id !== row.id),
        followed: current.followed.filter(item => item.id !== row.id)
      })), { submit: 'Supprimer', description: 'Le tirage et son suivi seront retirés de ton carnet.' }), { variant: 'quiet' }) : null,
      !archived && (row.releaseDate || row.deadline) ? button('Rappel calendrier', () => download(
        'pokeradar-' + row.id + '.ics',
        calendarFile({ ...row, date: row.releaseDate, description: row.note }), 'text/calendar;charset=utf-8'
      ), { variant: 'quiet', symbol: 'calendar' }) : null)
  );
}

function stocks() {
  const results = el('div', 'record-grid');
  const map = out('Chercher les magasins', mapUrl('cartes Pokémon près de ' + localZone));
  const zone = field('zone', 'Ville ou code postal', { value: localZone, maxLength: 100 });
  zone.querySelector('input').addEventListener('input', event => {
    localZone = event.target.value.trim() || 'Suresnes';
    map.href = mapUrl('cartes Pokémon près de ' + localZone);
  });
  const paint = () => {
    const rows = stockObservations(data.stocks).filter(item => filters.stock === 'Tous' || item.status === filters.stock);
    results.replaceChildren(...(rows.length ? rows.map(stockCard) : [empty('pin', 'Aucun relevé à afficher', 'Vérifie une fiche, appelle le magasin ou relève le stock en rayon, puis ajoute ta vérification.')]));
  };
  const bar = filterBar(['Tous', 'Disponible signalé', 'Indisponible signalé', 'Stock inconnu', 'Relevé à actualiser', 'Relevé remplacé'], filters.stock, value => { filters.stock = value; paint(); });
  paint();
  return [
    heading('Stocks locaux', 'Retrouve les magasins près de chez toi et note chaque vérification.',
      button('Ajouter un relevé', () => editStock(), { variant: 'primary', symbol: 'plus', disabled: !db })),
    el('section', 'panel', sectionTitle('Autour de moi'), el('div', 'inline-form', zone, map),
      el('p', 'muted mini', 'La carte indique où chercher. La disponibilité se vérifie auprès du magasin.')),
    watchPanel('pickup'),
    el('section', 'section', sectionTitle('Pistes près de Suresnes'),
      el('div', 'record-grid', LOCAL_STORES.map(store => el('article', 'record',
        el('div', 'record-top', badge('Stock inconnu')),
        el('h3', '', store.name), el('p', 'muted', store.location),
        el('div', 'actions', out('Infos magasin', store.url), out('Sur la carte', mapUrl(store.name + ' ' + store.location), 'quiet'),
          button('Relever', () => editStock('', store.name), { variant: 'quiet', disabled: !db }))))),
      out('Consulter les réassorts en ligne signalés par Radar Stock', 'https://radarstock.fr/reassorts/pokemon/', 'quiet')),
    el('section', 'section', sectionTitle('Mes vérifications'), bar, results)
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

function alerts() {
  const matching = currentAlerts();
  const followed = [...publicRaffles(), ...data.customRaffles].filter(row => data.followed.some(item => item.id === row.id));
  return [
    heading('Alertes et suivi', 'Suis un produit, un budget ou un tirage depuis ton carnet.',
      button('Créer une alerte', () => editAlert(), { variant: 'primary', symbol: 'plus', disabled: !db })),
    el('div', 'data-note', icon('bell'), el('div', '',
      el('strong', '', 'Alertes dans ton carnet'),
      el('p', '', 'Tes règles utilisent tes relevés de moins de 24 h et les disponibilités publiques de moins de 6 h. Les règles de prix utilisent les offres avec livraison connue.'),
      out('Canaux Radar Stock', RADAR_ALERTS, 'quiet'))),
    el('section', 'section', sectionTitle('Mes règles'),
      el('div', 'record-grid', matching.length ? matching.map(({ rule, rows }) => el('article', 'record',
        el('div', 'record-top', badge(rows.length ? 'Signal récent' : 'En veille', rows.length ? 'mint' : 'neutral')),
        el('h3', '', rule.product), el('p', 'muted', rule.type === 'stock' ? 'Disponibilité signalée' : 'Jusqu’à ' + euro.format(rule.max) + ' livraison comprise'),
        rows.length ? el('ul', 'signals', rows.map(row => el('li', '', row.store ?? row.source, ' · ', fullDate.format(new Date(row.checked)),
          row.url ? out('Voir la fiche', row.url, 'quiet') : null))) : null,
        el('div', 'actions', link('Ouvrir les relevés', rule.type === 'stock' ? '#stocks' : '#marche', { variant: 'quiet' }),
          button('Supprimer', () => removeRecord('alerts', rule.id, 'cette règle'), { variant: 'quiet' }))
      )) : empty('bell', 'Aucune règle créée', 'Ajoute un produit et choisis disponibilité ou prix total.'))),
    el('section', 'section', sectionTitle('Tirages suivis', link('Voir les tirages', '#boutiques/tirages', { variant: 'quiet' })),
      el('div', 'record-grid', followed.length ? followed.map(raffleCard) : empty('ticket', 'Aucun tirage suivi', 'Utilise le bouton Suivre sur un tirage à surveiller.')))
  ];
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

const views = { accueil: home, marche: market, boutiques, stocks, alertes: alerts, donnees: backups };
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
  screen.replaceChildren(...views[active]());
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
      const [health, feed] = await Promise.all(['./sante.json', './evenements.json'].map(async path => {
        try {
          const res = await fetch(path, { cache: 'no-store', signal: controller.signal });
          return res.ok ? await res.json() : null;
        } catch { return null; }
      }));
      const nextHealth = health && typeof health.hosts === 'object' && health.hosts ? health : null;
      const nextEvents = Array.isArray(feed?.events) ? feed.events.filter(event => event && typeof event.at === 'string' &&
        Number.isFinite(Date.parse(event.at)) && ['seller', 'product', 'type'].every(key => typeof event[key] === 'string')) : null;
      const changed = JSON.stringify(next) !== JSON.stringify(watch) ||
        JSON.stringify([nextHealth, nextEvents]) !== JSON.stringify([collectorHealth, collectorEvents]);
      collectorHealth = nextHealth;
      collectorEvents = nextEvents;
      watch = next;
      try { localStorage.setItem(watchKey, JSON.stringify(watch)); } catch {}
      const latest = watch.offers.filter(row => row.status !== 'unknown')
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      watchStatus.textContent = latest ? 'Dernier relevé marchand · ' + offerDate(latest) : 'Aucun relevé marchand publié.';
      if (changed) renderWhenIdle();
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
