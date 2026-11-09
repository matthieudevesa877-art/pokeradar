#!/usr/bin/env node
// Fusionne la liste de fiches du dépôt (graine) avec le dernier relevé publié sur la branche `data`.
//   node collector/merge-seed.mjs <graine.json> <relevé.json> <sortie.json>
// - la liste des fiches, campagnes et sorties vient de la graine (c'est elle qu'on modifie avec `npm run add`) ;
// - pour chaque fiche déjà observée, l'observation du relevé publié l'emporte (statut, prix, date, retraits) ;
// - une fiche retirée de la graine disparaît.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [seedPath, publishedPath, outPath] = process.argv.slice(2);
  const seed = JSON.parse(await readFile(seedPath, 'utf8'));
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));
  await writeFile(outPath, JSON.stringify(mergeSeed(seed, published), null, 2) + '\n', 'utf8');
}
