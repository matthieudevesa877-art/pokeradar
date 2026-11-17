#!/usr/bin/env node
// Collecte des signalements (Dealabs, Restock Collector, sites Auchan et Leclerc, réassorts détectés par PokéRadar),
// mise à jour de signaux.json et alertes téléphone (ntfy) pour les nouveaux signaux importants.
//   node collector/signals/run.mjs [--no-alert]
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { SOURCES } from './sources.mjs';
import { classify, isImportant, isPublicPrice } from './classify.mjs';
import { patterns } from './patterns.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = process.env.POKERADAR_DATA_DIR ? join(ROOT, process.env.POKERADAR_DATA_DIR) : join(ROOT, 'app');
const FILE = join(DATA, 'signaux.json');
const EVENTS = join(DATA, 'evenements.json');
const KEEP_DAYS = 45;
const MAX_SIGNALS = 1500;
const ALERT_WINDOW_MS = 6 * 3600000;
const MAX_ALERTS = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const say = text => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${text}`);
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}
async function writeJsonAtomic(path, data) {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 1) + '\n', 'utf8');
  await rename(temp, path);
}
async function log(entry) {
  const ts = new Date().toISOString();
  await mkdir(join(ROOT, 'collector', 'logs'), { recursive: true });
  await appendFile(join(ROOT, 'collector', 'logs', `${ts.slice(0, 10)}.jsonl`), JSON.stringify({ ts, type: 'signals', ...entry }) + '\n', 'utf8');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  if (res.status === 429) { const error = new Error('Limite de lecture atteinte (HTTP 429).'); error.kind = 'limité'; throw error; }
  if (!res.ok) { const error = new Error(`HTTP ${res.status}.`); error.kind = res.status === 403 ? 'bloqué' : 'erreur'; throw error; }
  return body;
}

// Réassorts détectés par le collecteur de fiches -> signaux « PokéRadar ».
export function signalsFromEvents(events) {
  return events.filter(event => ['restock', 'available', 'pickup'].includes(event.type)).map(event => {
    const label = { restock: 'Retour en stock', available: 'Disponible', pickup: 'Nouveau retrait en magasin' }[event.type];
    const title = `${label} : ${event.product} chez ${event.seller}${event.type === 'pickup' ? ' (' + event.to + ')' : ''}`;
    const info = classify(`${event.seller} ${event.product} ${event.type === 'pickup' ? 'retrait ' + event.to : ''}`);
    return {
      id: `radar:${event.at}:${event.id}:${event.type}`, at: event.at, source: 'PokéRadar', title, text: '', url: event.url,
      price: event.price ?? null, ...info, retailer: info.retailer || event.seller, tcg: true
    };
  });
}

// Une offre d'enseigne est intéressante si c'est une cible (30 ans, Règne Delta), du JCC, en stock et au prix public.
export function offerIsGood(offer) {
  const info = classify(offer.name);
  return offer.available && info.tcg && (info.targets.includes('30 ans') || info.targets.includes('Règne Delta')) && isPublicPrice(offer.name, offer.price) === true;
}

// Transforme les offres vues en signaux : un signal par « apparition » (absente depuis plus de 3 h puis revue).
export function signalsFromOffers(offers, watch, now = Date.now()) {
  const at = new Date(now).toISOString().replace(/.d{3}Z$/, 'Z');
  const signals = [];
  const available = [];
  for (const offer of offers.filter(offerIsGood)) {
    const key = `${offer.retailer}|${offer.url}`;
    const seen = watch[key];
    const reappeared = !seen || now - Date.parse(seen.lastSeen) > 3 * 3600000;
    const since = reappeared ? at : seen.since;
    watch[key] = { since, lastSeen: at, price: offer.price };
    const title = `Prix public chez ${offer.retailer} : ${offer.name} à ${offer.price} €${offer.seller && offer.seller !== offer.retailer ? ` (vendu par ${offer.seller})` : ''}`;
    const item = { ...classify(offer.name), id: `offer:${key}@${since}`, at: since, source: `${offer.retailer} (site)`, title, text: '', url: offer.url,
      price: offer.price, publicPrice: true, retailer: offer.retailer, big: true, kind: 'en ligne', tcg: true };
    available.push({ ...item, lastSeen: at });
    if (reappeared) signals.push(item);
  }
  for (const [key, value] of Object.entries(watch)) if (now - Date.parse(value.lastSeen) > 14 * 86400000) delete watch[key];
  return { signals, available };
}

export function mergeSignals(previous = [], incoming = [], now = Date.now()) {
  const byId = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, { ...byId.get(item.id), ...item });
  const sorted = [...byId.values()].map(item => ({ ...item, important: isImportant(item) }))
    .filter(item => now - Date.parse(item.at) < KEEP_DAYS * 86400000)
    .sort((a, b) => b.at.localeCompare(a.at));
  // Même annonce répétée (variantes d'une même fiche, republications) : on n'en garde qu'une par tranche de 12 h.
  const lastKept = new Map();
  const kept = [];
  for (const item of sorted) {
    const key = `${item.retailer}|${item.title}`;
    const previousAt = lastKept.get(key);
    if (previousAt && Date.parse(previousAt) - Date.parse(item.at) < 12 * 3600000) continue;
    lastKept.set(key, item.at);
    kept.push(item);
  }
  return kept.slice(0, MAX_SIGNALS);
}

// Fusion de deux fichiers signaux.json (PC et GitHub) : rien ne se perd, rien n'est alerté deux fois.
export function mergeSignalFiles(local, remote) {
  if (!local) return remote; if (!remote) return local;
  const signals = mergeSignals(remote.signals, local.signals);
  const newer = String(local.generatedAt) >= String(remote.generatedAt) ? local : remote;
  const watch = { ...remote.watch };
  for (const [key, value] of Object.entries(local.watch ?? {})) {
    if (!watch[key] || value.lastSeen > watch[key].lastSeen) watch[key] = value;
  }
  const sources = { ...remote.sources };
  for (const [name, value] of Object.entries(local.sources ?? {})) {
    if (!sources[name] || String(value.lastTryAt) > String(sources[name].lastTryAt)) sources[name] = value;
  }
  return { ...newer, signals, watch, sources, patterns: patterns(signals), notified: [...new Set([...(remote.notified ?? []), ...(local.notified ?? [])])].slice(-800) };
}

export function alertText(signal) {
  const where = [signal.retailer, signal.place || (signal.dept ? `(${signal.dept})` : '')].filter(Boolean).join(' · ');
  const tags = [signal.kind === 'magasin' ? 'office' : 'shopping_cart', ...(signal.targets.includes('30 ans') ? ['tada'] : [])];
  return {
    title: `${signal.kind === 'magasin' ? 'Magasin' : 'En ligne'}${where ? ' · ' + where : ''}`.slice(0, 120),
    body: `${signal.title}${signal.price ? ` · ${signal.price} €` : ''}\n${signal.source}`.slice(0, 400),
    tags: tags.join(','), click: signal.link || signal.url
  };
}

async function notify(signals) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !signals.length) return 0;
  const server = process.env.NTFY_SERVER ?? 'https://ntfy.sh';
  const send = async ({ title, body, tags, click, priority = '4' }) => {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST', body, signal: AbortSignal.timeout(15000),
      headers: { Title: encodeURIComponent(title), 'X-Title-Encoding': 'uri', Tags: tags, Priority: priority, ...(click ? { Click: click } : {}) }
    });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  };
  let sent = 0;
  for (const signal of signals.slice(0, MAX_ALERTS)) { await send(alertText(signal)); sent += 1; }
  if (signals.length > MAX_ALERTS) {
    await send({ title: `+${signals.length - MAX_ALERTS} autres signaux`, body: 'Ouvre PokéRadar pour tout voir.', tags: 'radar', priority: '3' });
  }
  return sent;
}

export async function runSignals({ alert = true } = {}) {
  const previous = await readJson(FILE, null);
  const firstRun = !previous;
  const health = { ...(previous?.sources ?? {}) };
  const incoming = [];
  const offersSeen = new Map();
  for (const source of SOURCES) {
    const h = health[source.name] ?? {};
    try {
      const body = await fetchText(source.url);
      let items;
      if (source.offers) {
        const offers = source.offers(body);
        offers.forEach(offer => offersSeen.set(offer.url, offer));
        items = offers;
        say(`✓ ${source.name} : ${offers.length} offre(s), ${offers.filter(offerIsGood).length} au prix public.`);
      } else {
        items = source.parse(body);
        incoming.push(...items);
        say(`✓ ${source.name} : ${items.length} élément(s), ${items.filter(item => item.tcg).length} JCC.`);
      }
      health[source.name] = { state: 'ok', lastTryAt: stamp(), lastOkAt: stamp(), items: items.length };
    } catch (error) {
      health[source.name] = { ...h, state: error.kind ?? 'erreur', lastTryAt: stamp(), lastError: error.message };
      say(`✗ ${source.name} : ${error.message}`);
    }
    await log({ source: source.name, ...health[source.name] });
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  const watch = { ...(previous?.watch ?? {}) };
  const { signals: offerSignals, available: availableNow } = signalsFromOffers([...offersSeen.values()], watch);
  incoming.push(...offerSignals);
  incoming.push(...signalsFromEvents((await readJson(EVENTS, { events: [] })).events ?? []));

  const known = new Set((previous?.signals ?? []).map(item => item.id));
  const signals = mergeSignals(previous?.signals, incoming);
  const available = availableNow.map(item => ({ ...item, important: isImportant(item) }));
  const fresh = signals.filter(item => !known.has(item.id));
  const notified = new Set(previous?.notified ?? []);
  const toAlert = firstRun ? [] : fresh.filter(item => isImportant(item) && !notified.has(item.id) && Date.now() - Date.parse(item.at) < ALERT_WINDOW_MS);
  let sent = 0;
  if (alert && toAlert.length) {
    try { sent = await notify(toAlert); toAlert.forEach(item => notified.add(item.id)); } catch (error) { say(`Alerte non envoyée : ${error.message}`); await log({ source: 'ntfy', state: 'erreur', lastError: error.message }); }
  }
  const output = {
    version: 1, generatedAt: stamp(), sources: health, patterns: patterns(signals), available, watch,
    signals, notified: [...notified].slice(-800)
  };
  await mkdir(DATA, { recursive: true });
  await writeJsonAtomic(FILE, output);
  await log({ source: 'bilan', total: signals.length, nouveaux: fresh.length, importants: toAlert.length, alertes: sent, premierPassage: firstRun });
  say(`Signaux : ${signals.length} au total, ${fresh.length} nouveau(x), ${toAlert.length} important(s), ${sent} alerte(s) envoyée(s)${firstRun ? ' (premier passage : pas d\'alerte)' : ''}.`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSignals({ alert: !process.argv.includes('--no-alert') }).catch(error => { console.error(`Erreur : ${error.message}`); process.exitCode = 1; });
}
