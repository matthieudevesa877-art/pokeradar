// Logique pure de rapprochement : anciennes observations + résultats des contrôles -> nouveau relevé,
// événements (réassorts, ruptures, prix) et santé par fiche. Aucune entrée/sortie ici, donc testable.

export const MAX_EVENTS = 300;
export const SUSPECT_RATIO = 0.6;   // au moins 60 % des fiches d'un site qui passent en rupture d'un coup
export const SUSPECT_MIN = 5;       // ... à partir de 5 fiches contrôlées : on soupçonne un changement de page

const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function sameStores(a = [], b = []) {
  return a.length === b.length && a.every(store => b.includes(store));
}

export function eventFor(prev, next, now) {
  const base = { at: now, id: next.id, product: next.product, seller: next.seller, url: next.url };
  const events = [];
  if (prev.status !== next.status) {
    if (next.status === 'available') {
      events.push({ ...base, type: prev.status === 'unavailable' ? 'restock' : 'available', from: prev.status, to: next.status, price: next.price });
    } else if (next.status === 'unavailable' && prev.status === 'available') {
      events.push({ ...base, type: 'soldout', from: prev.status, to: next.status });
    } else if (next.status === 'invitation') {
      events.push({ ...base, type: 'invitation', from: prev.status, to: next.status, price: next.price });
    }
  }
  if (prev.price && next.price && Math.abs(prev.price - next.price) >= 0.01) {
    events.push({ ...base, type: 'price', from: prev.price, to: next.price });
  }
  const added = (next.pickup ?? []).filter(store => !(prev.pickup ?? []).includes(store));
  if (added.length && next.status === 'available') {
    events.push({ ...base, type: 'pickup', to: added.join(', ') });
  }
  return events;
}

// outcomes : Map<id, { ok: true, result } | { ok: false, error: { kind, message } }>
export function reconcile({ offers, outcomes, health = {}, events = [], now = Date.now() }) {
  const stamp = iso(now);
  const hostOf = row => new URL(row.url).hostname;

  // Garde-fou : une vague de « rupture » sur un site entier ressemble plus à une page cassée qu'à un vrai vidage.
  const perHost = new Map();
  for (const row of offers) {
    const outcome = outcomes.get(row.id);
    if (!outcome?.ok) continue;
    const entry = perHost.get(hostOf(row)) ?? { ok: 0, flips: [] };
    entry.ok += 1;
    if (row.status === 'available' && outcome.result.status === 'unavailable') entry.flips.push(row.id);
    perHost.set(hostOf(row), entry);
  }
  const suspect = new Set();
  for (const entry of perHost.values()) {
    if (entry.ok >= SUSPECT_MIN && entry.flips.length / entry.ok >= SUSPECT_RATIO) entry.flips.forEach(id => suspect.add(id));
  }

  const nextHealth = { ...health };
  const newEvents = [];
  const nextOffers = offers.map(row => {
    const outcome = outcomes.get(row.id);
    if (!outcome) return row; // fiche non contrôlée dans ce passage : on ne touche à rien
    const h = { failures: 0, ...health[row.id] };
    if (outcome.ok && suspect.has(row.id)) {
      nextHealth[row.id] = { ...h, lastTryAt: stamp, failures: h.failures + 1, lastError: { kind: 'suspect', message: 'Rupture massive sur ce site : changement apparent de page, relevé conservé.' } };
      return row;
    }
    if (!outcome.ok) {
      nextHealth[row.id] = { ...h, lastTryAt: stamp, failures: h.failures + 1, lastError: outcome.error };
      return row; // l'ancienne observation et sa date restent : l'appli la marquera « À revérifier »
    }
    const { result } = outcome;
    const next = { ...row, status: result.status, price: result.price ?? row.price ?? null, observedAt: stamp };
    if (result.pickup !== undefined) next.pickup = result.pickup;
    if (result.details !== undefined) next.details = result.details;
    nextHealth[row.id] = { lastTryAt: stamp, lastOkAt: stamp, failures: 0 };
    newEvents.push(...eventFor(row, next, stamp));
    return next;
  });

  const changed = nextOffers.some((row, index) => row !== offers[index]);
  return {
    offers: nextOffers,
    health: nextHealth,
    events: [...newEvents, ...events].slice(0, MAX_EVENTS),
    newEvents,
    changed,
    suspect: [...suspect]
  };
}

export function summarize(offers, outcomes, health, now = Date.now()) {
  const hosts = {};
  for (const row of offers) {
    const host = new URL(row.url).hostname;
    const entry = hosts[host] ?? { checked: 0, ok: 0, blocked: 0, failed: 0, lastOkAt: null };
    const outcome = outcomes.get(row.id);
    if (outcome) {
      entry.checked += 1;
      if (outcome.ok) entry.ok += 1;
      else if (outcome.error.kind === 'blocked') entry.blocked += 1;
      else entry.failed += 1;
    }
    const lastOk = health[row.id]?.lastOkAt;
    if (lastOk && (!entry.lastOkAt || lastOk > entry.lastOkAt)) entry.lastOkAt = lastOk;
    hosts[host] = entry;
  }
  for (const entry of Object.values(hosts)) {
    entry.state = entry.checked === 0 ? 'non contrôlé' : entry.ok === entry.checked ? 'ok' : entry.ok === 0 ? (entry.blocked ? 'bloqué' : 'en panne') : 'partiel';
  }
  return { version: 1, generatedAt: iso(now), hosts };
}
