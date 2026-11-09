#!/usr/bin/env node
// Collecteur PokéRadar : contrôle les fiches de app/veille.json, journalise tout, publie d'un seul coup.
//   node collector/collect.mjs                 un passage
//   node collector/collect.mjs --watch 15      un passage toutes les ~15 min (±20 %)
//   node collector/collect.mjs --only ultrajeux.com --dry
//   node collector/collect.mjs --add URL [--product "Nom"]
import { appendFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { adapterFor, CheckError } from './adapters.mjs';
import { reconcile, summarize } from './engine.mjs';
import { decodeWatch } from '../app/watch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEED = join(ROOT, 'app', 'veille.json');
const EVENTS = join(ROOT, 'app', 'evenements.json');
const HEALTH = join(ROOT, 'app', 'sante.json');
const LOGS = join(ROOT, 'collector', 'logs');
const LOCK = join(ROOT, 'collector', '.lock');
const LOG_DAYS = 30;
const LOCK_STALE_MS = 20 * 60 * 1000;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'accept-language': 'fr-FR,fr;q=0.9', accept: 'text/html,application/xhtml+xml'
};
const JSON_HEADERS = { ...HEADERS, accept: 'application/json' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`${path} illisible : ${error.message}`);
  }
}

async function writeJsonAtomic(path, data) {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(temp, path);
}

// ——— journal ———
let runId = '';
async function log(entry) {
  const line = { ts: nowIso(), run: runId, ...entry };
  await mkdir(LOGS, { recursive: true });
  await appendFile(join(LOGS, `${line.ts.slice(0, 10)}.jsonl`), JSON.stringify(line) + '\n', 'utf8');
}
async function pruneLogs() {
  try {
    for (const name of await readdir(LOGS)) {
      const day = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)?.[1];
      if (day && Date.now() - Date.parse(day) > LOG_DAYS * 86400000) await rm(join(LOGS, name));
    }
  } catch { /* dossier absent : rien à nettoyer */ }
}
const say = text => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${text}`);

// ——— verrou : un seul collecteur à la fois ———
async function acquireLock() {
  try {
    await writeFile(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const held = await readJson(LOCK, null);
    if (held && Date.now() - held.at < LOCK_STALE_MS) throw new Error(`Un autre passage est en cours (pid ${held.pid}).`);
    await writeFile(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
  }
}
const releaseLock = () => unlink(LOCK).catch(() => {});

// ——— récupération d'une page ———
function decode(bytes, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.slice(0, 4096)))?.[1];
  try { return new TextDecoder(charset ?? 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

export async function fetchBody(url, { timeoutMs = 20000, json = false } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: json ? JSON_HEADERS : HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new CheckError(timeout ? 'timeout' : 'network', timeout ? `Délai dépassé (${timeoutMs} ms).` : `Réseau : ${error.cause?.code ?? error.message}`);
  }
  if (res.status === 403 || res.status === 429) throw new CheckError('blocked', `Accès refusé (HTTP ${res.status}).`, res.status);
  if (!res.ok) throw new CheckError('http', `HTTP ${res.status}.`, res.status);
  const body = decode(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'));
  if (!body.trim()) throw new CheckError('http', 'Réponse vide du serveur.', res.status);
  if (body.length < 30000 && /datadome|Pardon Our Interruption|Just a moment|cf-chl|Access Denied|Request unsuccessful/i.test(body)) {
    throw new CheckError('blocked', 'Page de protection anti-robot.', res.status);
  }
  return { body, status: res.status };
}

async function check(row) {
  const adapter = adapterFor(row.url);
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { body, status } = await fetchBody(adapter.requestUrl ? adapter.requestUrl(row.url) : row.url, { json: Boolean(adapter.requestUrl) });
      const result = adapter.parse(body);
      return { ok: true, result, http: status, ms: Date.now() - started, adapter: adapter.name, attempt };
    } catch (error) {
      const err = error instanceof CheckError ? error : new CheckError('parse', `Erreur inattendue : ${error.message}`);
      const retryable = ['network', 'timeout'].includes(err.kind) || (err.kind === 'http' && err.http >= 500);
      if (retryable && attempt < 2) { await sleep(4000 + Math.random() * 2000); continue; }
      return { ok: false, error: { kind: err.kind, message: err.message }, http: err.http, ms: Date.now() - started, adapter: adapter.name, attempt };
    }
  }
}

// ——— un passage ———
async function runOnce() {
  runId = randomBytes(3).toString('hex');
  const started = Date.now();
  const feed = await readJson(FEED, { version: 1, offers: [], campaigns: [], releases: [] });
  const prevEvents = (await readJson(EVENTS, { events: [] })).events ?? [];
  const prevHealth = (await readJson(HEALTH, { offers: {} })).offers ?? {};
  const only = option('--only');
  const targets = feed.offers.filter(row => !only || new URL(row.url).hostname.includes(only));

  await log({ type: 'run_start', offers: feed.offers.length, targets: targets.length, only: only ?? null, dry: flag('--dry') });
  say(`Passage ${runId} : ${targets.length} fiche(s) à contrôler.`);

  const byHost = new Map();
  for (const row of targets) {
    const host = new URL(row.url).hostname;
    byHost.set(host, [...(byHost.get(host) ?? []), row]);
  }

  const outcomes = new Map();
  await Promise.all([...byHost].map(async ([host, rows]) => {
    const gap = adapterFor(rows[0].url).gapMs;
    let blockedInARow = 0;
    for (const [index, row] of rows.entries()) {
      if (blockedInARow >= 2) { // le site nous refuse : inutile d'insister, on réessaiera au prochain passage
        const outcome = { ok: false, error: { kind: 'blocked', message: 'Site en pause après deux refus consécutifs.' }, skipped: true };
        outcomes.set(row.id, outcome);
        await log({ type: 'check', id: row.id, host, outcome: 'skipped', error: outcome.error });
        continue;
      }
      if (index) await sleep(gap * (0.8 + Math.random() * 0.4));
      const outcome = await check(row);
      outcomes.set(row.id, outcome);
      blockedInARow = !outcome.ok && outcome.error.kind === 'blocked' ? blockedInARow + 1 : 0;
      await log(outcome.ok
        ? { type: 'check', id: row.id, host, adapter: outcome.adapter, outcome: 'ok', http: outcome.http, ms: outcome.ms, attempt: outcome.attempt, status: outcome.result.status, price: outcome.result.price, pickup: outcome.result.pickup }
        : { type: 'check', id: row.id, host, adapter: outcome.adapter, outcome: outcome.error.kind, http: outcome.http, ms: outcome.ms, attempt: outcome.attempt, error: outcome.error.message });
      say(`${outcome.ok ? '✓' : '✗'} ${host} · ${row.product} · ${outcome.ok ? `${outcome.result.status}${outcome.result.price ? ' ' + outcome.result.price + ' €' : ''}` : `${outcome.error.kind} (${outcome.error.message})`}`);
    }
  }));

  const result = reconcile({ offers: feed.offers, outcomes, health: prevHealth, events: prevEvents });
  decodeWatch({ ...feed, offers: result.offers }); // refuse tout relevé invalide avant d'écrire quoi que ce soit

  for (const event of result.newEvents) {
    await log({ ...event, type: 'event', kind: event.type });
    say(`➜ ${event.type.toUpperCase()} · ${event.seller} · ${event.product}${event.to ? ' → ' + event.to : ''}`);
  }
  for (const id of result.suspect) await log({ type: 'suspect', id, message: 'Rupture massive : relevé conservé.' });

  const summary = summarize(feed.offers, outcomes, result.health);
  const failedTotal = [...outcomes.values()].filter(o => !o.ok).length;
  if (!flag('--dry')) {
    if (result.changed) await writeJsonAtomic(FEED, { ...feed, offers: result.offers });
    await writeJsonAtomic(EVENTS, { version: 1, events: result.events });
    await writeJsonAtomic(HEALTH, { ...summary, run: { id: runId, durationMs: Date.now() - started, checked: outcomes.size, failed: failedTotal, events: result.newEvents.length }, offers: result.health });
  }
  await log({ type: 'run_end', durationMs: Date.now() - started, checked: outcomes.size, ok: outcomes.size - failedTotal, failed: failedTotal, events: result.newEvents.length, suspect: result.suspect.length, written: !flag('--dry') && result.changed });
  say(`Terminé en ${Math.round((Date.now() - started) / 1000)} s : ${outcomes.size - failedTotal} ok, ${failedTotal} en échec, ${result.newEvents.length} événement(s).${flag('--dry') ? ' (essai à blanc : rien écrit)' : ''}`);
  return { failedTotal, checked: outcomes.size };
}

// ——— ajout d'une fiche ———
function slug(url) {
  const u = new URL(url);
  return (u.pathname.split('/').filter(Boolean).pop() ?? u.hostname).replace(/\.html?$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) || u.hostname;
}

async function addOffer(url) {
  runId = randomBytes(3).toString('hex');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Seules les adresses https sont acceptées.');
  const feed = await readJson(FEED, { version: 1, offers: [], campaigns: [], releases: [] });
  if (feed.offers.some(row => row.url === url)) throw new Error('Cette fiche est déjà suivie.');
  const adapter = adapterFor(url);
  const row = { id: slug(url), product: option('--product') ?? '', seller: option('--seller') ?? parsed.hostname.replace(/^www\./, ''), url, price: null, status: 'unknown', observedAt: nowIso().slice(0, 10) };
  if (feed.offers.some(other => other.id === row.id)) row.id = `${row.id}-${randomBytes(2).toString('hex')}`;
  const { body } = await fetchBody(adapter.requestUrl ? adapter.requestUrl(url) : url, { json: Boolean(adapter.requestUrl) });
  const result = adapter.parse(body);
  if (!row.product) row.product = (/<meta property="og:title" content="([^"]+)"/i.exec(body)?.[1] ?? /<title[^>]*>([^<]+)/i.exec(body)?.[1] ?? row.id).replace(/\s+/g, ' ').trim().slice(0, 170);
  Object.assign(row, { status: result.status, price: result.price ?? null, observedAt: nowIso().replace(/\.\d{3}Z$/, 'Z'), pickup: result.pickup ?? [] });
  decodeWatch({ ...feed, offers: [...feed.offers, row] });
  await writeJsonAtomic(FEED, { ...feed, offers: [...feed.offers, row] });
  await log({ type: 'add', id: row.id, host: adapter.host, adapter: adapter.name, status: row.status, price: row.price });
  say(`Ajouté : ${row.product} (${adapter.name}) · ${row.status}${row.price ? ' · ' + row.price + ' €' : ''}`);
}

// ——— entrée ———
async function main() {
  await mkdir(dirname(LOCK), { recursive: true });
  await acquireLock();
  process.on('SIGINT', async () => { await releaseLock(); process.exit(130); });
  try {
    await pruneLogs();
    if (flag('--add')) { await addOffer(option('--add')); return; }
    const watch = Number(option('--watch'));
    if (!watch) { const { failedTotal, checked } = await runOnce(); process.exitCode = checked && failedTotal === checked ? 2 : 0; return; }
    for (;;) {
      try { await runOnce(); } catch (error) { await log({ type: 'run_error', message: error.message }); say(`Passage échoué : ${error.message}`); }
      const wait = watch * 60000 * (0.8 + Math.random() * 0.4);
      say(`Prochain passage dans ${Math.round(wait / 60000)} min.`);
      await sleep(wait);
    }
  } catch (error) {
    await log({ type: 'fatal', message: error.message }).catch(() => {});
    console.error(`Erreur : ${error.message}`);
    process.exitCode = 1;
  } finally {
    await releaseLock();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
