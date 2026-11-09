// Fusions pures du relevé : graine du dépôt, relevé publié, et relevés de plusieurs collecteurs.
// (Aussi utilisable en ligne de commande :  node collector/merge-seed.mjs <graine> <relevé> <sortie>)
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_EVENTS = 300;

// La liste des fiches, campagnes et sorties vient de la graine (modifiée par `npm run add`) ;
// pour chaque fiche déjà observée, l'observation publiée l'emporte. Une fiche retirée de la graine disparaît.
export function mergeSeed(seed, published) {
  const seen = new Map((published?.offers ?? []).map(row => [row.id, row]));
  return {
    ...seed,
    offers: seed.offers.map(row => {
      const observed = seen.get(row.id);
      return observed && observed.url === row.url ? { ...row, ...observed, product: row.product, seller: row.seller } : row;
    })
  };
}

// Deux collecteurs ont chacun leur copie : pour chaque fiche on garde l'observation la plus récente.
export function mergeLatest(local, remote) {
  const other = new Map((remote?.offers ?? []).map(row => [row.id, row]));
  return {
    ...local,
    offers: local.offers.map(row => {
      const twin = other.get(row.id);
      return twin && twin.url === row.url && String(twin.observedAt) > String(row.observedAt) ? twin : row;
    })
  };
}

export function mergeEvents(local = [], remote = []) {
  const seen = new Map();
  for (const event of [...local, ...remote]) seen.set(`${event.at}|${event.id}|${event.type}`, event);
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_EVENTS);
}

export function mergeHealth(local = {}, remote = {}) {
  const merged = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[id], b = remote[id];
    if (!a || !b) { merged[id] = a ?? b; continue; }
    const latest = String(b.lastTryAt) > String(a.lastTryAt) ? b : a;
    const lastOkAt = [a.lastOkAt, b.lastOkAt].filter(Boolean).sort().pop();
    const entry = { ...latest };
    if (lastOkAt) entry.lastOkAt = lastOkAt;
    if (lastOkAt && lastOkAt >= String(latest.lastTryAt)) { entry.failures = 0; delete entry.lastError; }
    merged[id] = entry;
  }
  return merged;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [seedPath, publishedPath, outPath] = process.argv.slice(2);
  const seed = JSON.parse(await readFile(seedPath, 'utf8'));
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));
  await writeFile(outPath, JSON.stringify(mergeSeed(seed, published), null, 2) + '\n', 'utf8');
}
