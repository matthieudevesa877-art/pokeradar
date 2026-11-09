#!/usr/bin/env node
// Un passage complet : reprendre le dernier relevé publié (branche `data`) -> collecter -> fusionner -> publier.
// Utilisé à la fois par le PC (`npm run sync`) et par GitHub Actions : les deux publient dans le même relevé
// sans s'écraser (fusion fiche par fiche, la plus récente l'emporte ; publication refusée si quelqu'un a publié entre-temps).
//   node collector/sync.mjs                un passage
//   node collector/sync.mjs --watch 15     un passage toutes les ~15 min
//   node collector/sync.mjs --no-push      collecte et fusionne, sans publier
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarize } from './engine.mjs';
import { mergeEvents, mergeHealth, mergeLatest, mergeSeed } from './merge-seed.mjs';
import { decodeWatch } from '../app/watch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_REL = 'collector/data';
const DATA = join(ROOT, DATA_REL);
const SEED = join(ROOT, 'app', 'veille.json');
const FILES = { feed: 'veille.json', events: 'evenements.json', health: 'sante.json' };
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const say = text => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${text}`);
const SOURCE = process.env.GITHUB_ACTIONS ? 'github' : 'pc';

function git(gitArgs, env) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50e6, stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env }).trim();
}

async function journal(entry) {
  const ts = new Date().toISOString();
  await mkdir(join(ROOT, 'collector', 'logs'), { recursive: true });
  await appendFile(join(ROOT, 'collector', 'logs', `${ts.slice(0, 10)}.jsonl`), JSON.stringify({ ts, source: SOURCE, ...entry }) + '\n', 'utf8');
}

async function readLocal(name) {
  try { return JSON.parse(await readFile(join(DATA, name), 'utf8')); } catch { return null; }
}
const writeJson = (name, data) => writeFile(join(DATA, name), JSON.stringify(data, null, 2) + '\n', 'utf8');

function fetchRemote() {
  let sha;
  try { sha = git(['ls-remote', '--heads', 'origin', 'data']).split(/\s+/)[0]; } catch (error) {
    throw new Error(`GitHub injoignable : ${error.stderr?.toString().trim() || error.message}`);
  }
  if (!sha) return null; // première publication : la branche data n'existe pas encore
  git(['fetch', '--depth=1', 'origin', 'data']);
  const read = name => { try { return JSON.parse(git(['show', `FETCH_HEAD:app/${name}`])); } catch { return null; } };
  return { sha, feed: read(FILES.feed), events: read(FILES.events), health: read(FILES.health) };
}

async function restore() {
  const seed = JSON.parse(await readFile(SEED, 'utf8'));
  let remote = null;
  try { remote = fetchRemote(); } catch (error) { say(`Relevé en ligne indisponible (${error.message}) : reprise du relevé local.`); }
  await mkdir(DATA, { recursive: true });
  const base = remote?.feed ?? await readLocal(FILES.feed);
  await writeJson(FILES.feed, mergeSeed(seed, base));
  await writeJson(FILES.events, { version: 1, events: (remote?.events ?? await readLocal(FILES.events))?.events ?? [] });
  await writeJson(FILES.health, remote?.health ?? await readLocal(FILES.health) ?? { version: 1, hosts: {}, offers: {} });
  say(remote ? 'Dernier relevé en ligne repris.' : 'Aucun relevé en ligne : départ depuis la liste du dépôt.');
}

function collect() {
  const extra = option('--only') ? ['--only', option('--only')] : [];
  const result = spawnSync(process.execPath, [join(ROOT, 'collector', 'collect.mjs'), ...extra], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, POKERADAR_DATA_DIR: DATA_REL }
  });
  if (result.status !== 0 && result.status !== 2) throw new Error(`Le collecteur s'est arrêté (code ${result.status}).`);
}

function commitAndPush(remote, message) {
  const indexFile = join(git(['rev-parse', '--absolute-git-dir']), 'pokeradar-index');
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    for (const name of Object.values(FILES)) {
      git(['update-index', '--add', '--cacheinfo', `100644,${git(['hash-object', '-w', join(DATA, name)])},app/${name}`], env);
    }
    const commit = git(['commit-tree', git(['write-tree'], env), '-m', message]);
    git(['push', ...(remote ? [`--force-with-lease=refs/heads/data:${remote.sha}`] : []), 'origin', `${commit}:refs/heads/data`]);
  } finally {
    try { execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', '/q', indexFile] : ['-f', indexFile], { stdio: 'ignore' }); } catch { /* index temporaire déjà absent */ }
  }
}

async function publish() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const remote = fetchRemote();
    const feed = mergeLatest(await readLocal(FILES.feed), remote?.feed);
    const events = mergeEvents((await readLocal(FILES.events))?.events, remote?.events?.events);
    const local = await readLocal(FILES.health);
    const health = mergeHealth(local?.offers, remote?.health?.offers);
    decodeWatch(feed); // jamais de relevé invalide en ligne
    const sante = { ...summarize(feed.offers, health), run: local?.run, source: SOURCE, offers: health };
    await writeJson(FILES.feed, feed);
    await writeJson(FILES.events, { version: 1, events });
    await writeJson(FILES.health, sante);
    if (flag('--no-push')) { say('Fusion faite, publication ignorée (--no-push).'); return; }
    try {
      commitAndPush(remote, `Relevé ${sante.generatedAt} (${SOURCE})`);
      await journal({ type: 'publish', attempt, offers: feed.offers.length });
      say(`Relevé publié (essai ${attempt}).`);
      return;
    } catch (error) {
      await journal({ type: 'publish_retry', attempt, message: String(error.stderr ?? error.message).trim().slice(0, 300) });
      say(`Publication refusée (essai ${attempt}) : un autre collecteur a publié entre-temps, je fusionne et je réessaie.`);
      await sleep(2000 * attempt);
    }
  }
  throw new Error('Publication impossible après 4 essais.');
}

async function once() {
  await restore();
  collect();
  await publish();
}

async function main() {
  if (!existsSync(join(ROOT, '.git'))) throw new Error('Ce dossier n\'est pas un dépôt Git relié à GitHub.');
  const watch = Number(option('--watch'));
  if (!watch) { await once(); return; }
  for (;;) {
    try { await once(); } catch (error) { await journal({ type: 'sync_error', message: error.message }); say(`Passage échoué : ${error.message}`); }
    const wait = watch * 60000 * (0.8 + Math.random() * 0.4);
    say(`Prochain passage dans ${Math.round(wait / 60000)} min.`);
    await sleep(wait);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Erreur : ${error.message}`); process.exitCode = 1; });
}
