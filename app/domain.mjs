export const STOCK_STATES = ['Inconnu', 'Disponible signalé', 'Indisponible signalé'];
export const METHODS = ['Page du magasin', 'Appel téléphonique', 'Retrait préparé', 'Observé en rayon'];
export const PRICE_KINDS = ['Annonce', 'Vente réalisée', 'Prix boutique', 'Cote indicative', 'Vente à vérifier'];
export const ENTRY_STATES = ['Non inscrit', 'Inscrit', 'Invitation reçue', 'Gagné', 'Non retenu', 'Commandé'];
export const RAFFLE_CATEGORIES = ['Accès à l’achat', 'À surveiller', 'Concours pour gagner'];
export const LEGACY_KEY = 'pokeradar_mobile_stocks_v04';
const MAX_RECORDS = 25000;
const VERSION = 1;
const COLLECTIONS = ['stocks', 'prices', 'alerts', 'followed', 'customRaffles', 'calendar'];
const HOUR = 3600000;

export function emptyData() {
  return { format: 'pokeradar', version: VERSION, ...Object.fromEntries(COLLECTIONS.map(key => [key, []])) };
}

export function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function required(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error('Un champ texte est vide ou trop long.');
  }
  return value.trim();
}

function optional(value, max) {
  return value === undefined || value === '' ? '' : required(value, max);
}

function amount(value, optional = false) {
  if (optional && (value === null || value === '')) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error('Un montant est manquant.');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) {
    throw new Error('Les montants doivent être compris entre 0 et 1 000 000 €.');
  }
  return number;
}

export function httpsUrl(value = '') {
  if (value === '') return '';
  try {
    const url = new URL(required(value, 2048));
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return value.trim();
  } catch {}
  throw new Error('Utilise une adresse HTTPS valide.');
}

function observationDate(value, now) {
  const timestamp = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(timestamp) || timestamp > now + 5 * 60000) {
    throw new Error('La date du relevé doit être valide et ne peut pas être dans le futur.');
  }
  return new Date(timestamp).toISOString();
}

function choice(value, options) {
  if (!options.includes(value)) throw new Error('Une valeur du fichier est inconnue.');
  return value;
}

export function stockRecord(row, now = Date.now()) {
  return {
    id: required(row.id, 160),
    product: required(row.product, 160),
    store: required(row.store, 100),
    state: choice(row.state, STOCK_STATES),
    price: amount(row.price, true),
    method: choice(row.method, [...METHODS, 'Bot v0.4']),
    url: httpsUrl(row.url),
    checked: observationDate(row.checked, now),
    ...(row.detail ? { detail: required(row.detail, 300) } : {})
  };
}

export function priceRecord(row, now = Date.now()) {
  return {
    id: required(row.id, 160),
    product: required(row.product, 160),
    source: required(row.source, 100),
    kind: choice(row.kind, PRICE_KINDS),
    price: amount(row.price),
    shipping: amount(row.shipping, true),
    url: httpsUrl(row.url),
    checked: observationDate(row.checked, now),
    ...(row.detail ? { detail: required(row.detail, 300) } : {}),
    ...(row.outOfStock === true ? { outOfStock: true } : {})
  };
}

export function alertRecord(row) {
  return {
    id: required(row.id, 160),
    product: required(row.product, 160),
    type: choice(row.type, ['stock', 'price']),
    max: row.type === 'price' ? amount(row.max) : null
  };
}

export function participationRecord(row) {
  return {
    id: required(row.id, 160),
    ...(row.status ? { status: choice(row.status, ENTRY_STATES), note: optional(row.note, 500) } : {})
  };
}

export function customRaffleRecord(row) {
  const deadline = row.deadline ? new Date(row.deadline).toISOString() : '';
  const url = httpsUrl(required(row.url, 2048));
  return {
    id: required(row.id, 160), brand: required(row.brand, 100), title: required(row.title, 180),
    category: choice(row.category, RAFFLE_CATEGORIES), method: optional(row.method, 150), url,
    requirements: optional(row.requirements, 300), deadline, source: url,
    state: 'à vérifier', note: 'Ajout personnel. Vérifie l’ouverture sur le site de l’enseigne.'
  };
}

export function calendarRecord(row) {
  const date = required(row.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Date de calendrier invalide.');
  }
  return {
    id: required(row.id, 160), title: required(row.title, 180), date,
    detail: required(row.detail, 100), url: httpsUrl(required(row.url, 2048)),
    description: optional(row.description, 500), tone: 'pink'
  };
}

export function decodeBackup(raw, now = Date.now()) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const input = Array.isArray(parsed) ? { ...emptyData(), stocks: parsed } : parsed;
  if (input?.format !== 'pokeradar' || input.version !== VERSION) {
    throw new Error('Sélectionne une sauvegarde PokéRadar ou le JSON des stocks du portail v0.4.');
  }
  const validators = {
    stocks: stockRecord, prices: priceRecord, alerts: alertRecord,
    followed: participationRecord, customRaffles: customRaffleRecord, calendar: calendarRecord
  };
  const output = emptyData();
  for (const key of COLLECTIONS) {
    if (input[key] === undefined && ['customRaffles', 'calendar'].includes(key)) continue;
    if (!Array.isArray(input[key]) || input[key].length > MAX_RECORDS) {
      throw new Error('Une liste manque ou dépasse la capacité d’import.');
    }
    output[key] = input[key].map((row, index) => {
      try {
        return validators[key](row, now);
      } catch (error) {
        throw new Error('Entrée ' + (index + 1) + ' de ' + key + '. ' + error.message);
      }
    });
  }
  return mergeData(emptyData(), output);
}

export function mergeData(current, incoming) {
  const result = emptyData();
  if (current.portalMigrated) result.portalMigrated = true;
  for (const key of COLLECTIONS) {
    const records = new Map(current[key].map(row => [row.id, row]));
    for (const row of incoming[key]) {
      const previous = records.get(row.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
        throw new Error('Deux entrées ont le même identifiant et des données différentes. La sauvegarde actuelle est intacte.');
      }
      records.set(row.id, row);
    }
    if (records.size > MAX_RECORDS) throw new Error('La capacité de stockage de cette liste est atteinte.');
    result[key] = [...records.values()];
  }
  return result;
}

export function marginEstimate({ buy, shipping, sell, fees, other }) {
  const cost = amount(buy) + amount(shipping) + amount(other);
  const fee = amount(fees);
  if (fee > 100) throw new Error('Les frais de vente doivent être compris entre 0 et 100 %.');
  const net = amount(sell) * (1 - fee / 100);
  const gain = Math.round((net - cost) * 100) / 100;
  return { gain, ratio: cost > 0 ? gain / cost * 100 : null, breakEven: fee < 100 ? cost / (1 - fee / 100) : null };
}

export function newest(rows) {
  return [...rows].sort((first, second) => second.checked.localeCompare(first.checked));
}

export function stockStatus(row, now = Date.now()) {
  if (row.state === 'Inconnu') return 'Stock inconnu';
  if (now - Date.parse(row.checked) >= 24 * HOUR) return 'Relevé à actualiser';
  return row.state;
}

export function stockObservations(rows, now = Date.now()) {
  const seen = new Set();
  return newest(rows).map(row => {
    const key = JSON.stringify([normalize(row.product), normalize(row.store)]);
    const current = !seen.has(key);
    seen.add(key);
    return { row, status: current ? stockStatus(row, now) : 'Relevé remplacé' };
  });
}

export function alertMatches(data, now = Date.now()) {
  const stocks = stockObservations(data.stocks, now)
    .filter(item => item.status === 'Disponible signalé').map(item => item.row);
  const prices = new Map();
  for (const row of newest(data.prices)) {
    const key = JSON.stringify([normalize(row.product), normalize(row.source), row.kind, row.url]);
    if (!prices.has(key)) prices.set(key, row);
  }
  return data.alerts.map(rule => {
    const candidates = rule.type === 'stock' ? stocks : [...prices.values()];
    const rows = candidates.filter(row => {
      const age = now - Date.parse(row.checked);
      if (normalize(row.product) !== normalize(rule.product) || age < 0 || age >= 24 * HOUR) return false;
      if (rule.type === 'stock') return true;
      return isPurchaseOffer(row) && cents(row.price) + cents(row.shipping) <= cents(rule.max);
    });
    return { rule, rows };
  });
}

function cents(value) {
  return Math.round(value * 100);
}

function isPurchaseOffer(row) {
  return ['Annonce', 'Prix boutique'].includes(row.kind) && row.shipping !== null && !row.outOfStock;
}

export function marketSummary(rows) {
  if (!rows.length) return null;
  if (new Set(rows.map(row => normalize(row.product))).size !== 1) return null;
  const sold = rows.filter(row => row.kind === 'Vente réalisée');
  const asking = rows.filter(isPurchaseOffer);
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return {
    sold: sold.length ? median(sold.map(row => row.price)) : null,
    soldCount: sold.length,
    asking: asking.length ? Math.min(...asking.map(row => (cents(row.price) + cents(row.shipping)) / 100)) : null,
    askingCount: asking.length
  };
}

export function raffleStatus(raffle, now = Date.now()) {
  if (raffle.state === 'signalé') return 'Signalé';
  if (raffle.state === 'clos') return 'Clôturé';
  if (raffle.deadline && Date.parse(raffle.deadline) <= now) return 'Date dépassée';
  if (raffle.state === 'annoncé' && raffle.verified) return 'Annoncé par l’enseigne';
  return raffle.state === 'à surveiller' ? 'À surveiller' : 'À vérifier';
}

export function searchUrl(source, query) {
  const templates = {
    amazon: 'https://www.amazon.fr/s?k=',
    fnac: 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=',
    ebay: 'https://www.ebay.fr/sch/i.html?_nkw=',
    cardmarket: 'https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=',
    vinted: 'https://www.vinted.fr/catalog?search_text=',
    leboncoin: 'https://www.leboncoin.fr/recherche?text='
  };
  if (!query || source.strategy === 'category') return source.site;
  const template = templates[source.strategy];
  if (template) return template + encodeURIComponent(query);
  return 'https://www.google.com/search?q=' + encodeURIComponent('site:' + source.domain + ' ' + query);
}

export function mapUrl(search) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(search);
}

export function calendarFile(event, now = new Date()) {
  const escape = text => text.replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/([,;])/g, '\\$1');
  const utc = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = event.date ? 'DTSTART;VALUE=DATE:' + event.date.replace(/-/g, '') : 'DTSTART:' + utc(new Date(event.deadline));
  const fold = line => {
    const encoder = new TextEncoder();
    let column = 0;
    let result = '';
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (column + bytes > 75) {
        result += '\r\n ';
        column = 1;
      }
      result += char;
      column += bytes;
    }
    return result;
  };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PokeRadar//Agenda FR//FR',
    'BEGIN:VEVENT', 'UID:' + escape(event.id) + '@pokeradar.local',
    'DTSTAMP:' + utc(now), start, 'SUMMARY:' + escape(event.title),
    'DESCRIPTION:' + escape(event.description), 'URL:' + httpsUrl(event.url),
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + escape(event.title),
    'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''
  ].map(fold).join('\r\n');
}
